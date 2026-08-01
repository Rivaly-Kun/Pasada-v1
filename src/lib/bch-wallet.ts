import {
  binToHex,
  decodeCashAddress,
  decodePrivateKeyWif,
  encodePrivateKeyWif,
  generatePrivateKey,
  hash160,
  privateKeyToP2pkhCashAddress,
  secp256k1,
} from "@bitauth/libauth"

export type GeneratedBchWallet = {
  address: string
  privateKeyWif: string
}

export type BchAddressInfo = {
  address: string
  spendableSats: number
}

/** Creates a standard chipnet (BCH testnet4) P2PKH wallet entirely in the browser. */
export function generateBchWallet(): GeneratedBchWallet {
  const privateKey = generatePrivateKey()
  const result = privateKeyToP2pkhCashAddress({ privateKey, prefix: "bchtest" })
  return {
    address: result.address,
    privateKeyWif: encodePrivateKeyWif(privateKey, "testnet"),
  }
}

/** Validates CashAddr prefix, payload length, type, and checksum for Chipnet / Mainnet. */
export function normalizeAndValidateBchAddress(
  value: string,
): { valid: true; address: string } | { valid: false; error: string } {
  const compact = value.trim()
  if (!compact) return { valid: false, error: "Enter your BCH address." }

  // Prefer chipnet (bchtest:) unless explicitly prefixed with bitcoincash:
  let normalized = compact.toLowerCase()
  if (!normalized.includes(":")) {
    normalized = `bchtest:${normalized}`
  }

  const decoded = decodeCashAddress(normalized)
  if (typeof decoded === "string") {
    // Try mainnet prefix if chipnet decode failed and no prefix was initially specified
    if (!compact.includes(":")) {
      const altNormalized = `bitcoincash:${compact.toLowerCase()}`
      const altDecoded = decodeCashAddress(altNormalized)
      if (typeof altDecoded !== "string") {
        return { valid: true, address: altNormalized }
      }
    }
    return {
      valid: false,
      error: "This BCH address has an invalid format or checksum.",
    }
  }

  if (decoded.prefix !== "bchtest" && decoded.prefix !== "bitcoincash") {
    return {
      valid: false,
      error:
        "Use a valid Bitcoin Cash address starting with bchtest: or bitcoincash:.",
    }
  }

  return { valid: true, address: normalized }
}

/** Verifies that a WIF key controls the supplied CashAddr without persisting it. */
export function validatePrivateKeyForBchAddress(
  privateKeyWif: string,
  address: string,
): { valid: true; address: string; privateKeyWif: string } | {
  valid: false
  error: string
} {
  const validatedAddress = normalizeAndValidateBchAddress(address)
  if (!validatedAddress.valid) return validatedAddress

  const key = privateKeyWif.trim()
  const decodedWif = decodePrivateKeyWif(key)
  if (typeof decodedWif === "string") {
    return {
      valid: false,
      error: "Enter a valid BCH private key in WIF format.",
    }
  }

  const prefix = (validatedAddress.address.split(":")[0] as "bchtest" | "bitcoincash" | "bchreg") || "bchtest"
  const derived = privateKeyToP2pkhCashAddress({
    privateKey: decodedWif.privateKey,
    prefix,
  }).address
  if (derived.toLowerCase() !== validatedAddress.address.toLowerCase()) {
    return {
      valid: false,
      error: "This private key does not control the displayed BCH address.",
    }
  }

  return { valid: true, address: validatedAddress.address, privateKeyWif: key }
}

/** Derives the compressed public key for a local PASADA wallet without persisting it. */
export function publicKeyForLocalBchWallet(
  privateKeyWif: string,
  address: string,
): string {
  const validated = validatePrivateKeyForBchAddress(privateKeyWif, address)
  if (!validated.valid) throw new Error(validated.error)
  const decoded = decodePrivateKeyWif(validated.privateKeyWif)
  if (typeof decoded === "string") throw new Error("The local BCH key is invalid.")
  const publicKey = secp256k1.derivePublicKeyCompressed(decoded.privateKey)
  if (typeof publicKey === "string") throw new Error(publicKey)
  return binToHex(publicKey)
}

/** Confirms that a compressed P2PKH public key belongs to the supplied address. */
export function verifyPublicKeyForBchAddress(
  publicKeyHex: string,
  address: string,
): string {
  const validated = normalizeAndValidateBchAddress(address)
  if (!validated.valid) throw new Error(validated.error)
  const normalizedKey = publicKeyHex.trim().toLowerCase()
  if (!/^(02|03)[0-9a-f]{64}$/.test(normalizedKey)) {
    throw new Error("The BCH wallet did not provide a valid compressed public key.")
  }
  const decodedAddress = decodeCashAddress(validated.address)
  if (typeof decodedAddress === "string") throw new Error("The BCH address is invalid.")
  const publicKey = Uint8Array.from(
    normalizedKey.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16)),
  )
  const addressHash = decodedAddress.payload as Uint8Array
  const publicKeyHash = hash160(publicKey)
  if (
    publicKeyHash.length !== addressHash.length ||
    publicKeyHash.some((value, index) => value !== addressHash[index])
  ) {
    throw new Error("The BCH public key does not control the supplied address.")
  }
  return normalizedKey
}

// ─── Electrum Scripthash ──────────────────────────────────────────────────────

/**
 * Derives the Electrum scripthash for a P2PKH CashAddr address using the
 * Web Crypto API (browser-native SHA-256). The locking script is:
 *   OP_DUP OP_HASH160 <20-byte pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
 * The scripthash is SHA256(script) with bytes reversed, encoded as hex.
 */
async function addressToElectrumScripthash(address: string): Promise<string> {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === "string")
    throw new Error("Invalid CashAddr: " + decoded)

  // decoded.payload is the 20-byte pubKeyHash for P2PKH
  const pkh = decoded.payload as Uint8Array

  // Build the P2PKH locking script
  const script = new Uint8Array([
    0x76,
    0xa9,
    0x14, // OP_DUP OP_HASH160 <20 bytes>
    ...pkh,
    0x88,
    0xac, // OP_EQUALVERIFY OP_CHECKSIG
  ])

  const hashBuf = await crypto.subtle.digest("SHA-256", script)
  const hashArr = new Uint8Array(hashBuf)

  // Reverse byte order (Electrum convention)
  hashArr.reverse()

  return Array.from(hashArr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// ─── Fulcrum Electrum WSS ─────────────────────────────────────────────────────

interface FulcrumBalance {
  confirmed: number
  unconfirmed: number
}

// Public chipnet Fulcrum nodes with WSS support
// These nodes run on the Chipnet testnet4 BCH network
const CHIPNET_WSS_NODES = [
  "wss://chipnet.bch.ninja:50004",
  "wss://chipnet.imaginary.cash:50004",
]

const MAINNET_WSS_NODES = [
  "wss://electroncash.de:50004",
  "wss://electron.jochen-hoenicke.de:51002",
  "wss://fulcrum.siftbitcoin.com:50004",
]

/**
 * Queries a Fulcrum Electrum node via WSS for the balance of a scripthash.
 * Uses the blockchain.scripthash.get_balance method.
 */
function queryFulcrumWss(
  wssUrl: string,
  scripthash: string,
  timeoutMs = 8000,
): Promise<FulcrumBalance> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
    }

    try {
      ws = new WebSocket(wssUrl)
    } catch {
      return reject(new Error(`Cannot open WebSocket to ${wssUrl}`))
    }

    timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timeout connecting to ${wssUrl}`))
    }, timeoutMs)

    ws.onopen = () => {
      const req =
        JSON.stringify({
          id: 1,
          method: "blockchain.scripthash.get_balance",
          params: [scripthash],
        }) + "\n"
      ws!.send(req)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        if (data.id === 1) {
          cleanup()
          if (data.error)
            return reject(new Error(data.error.message || "Electrum RPC error"))
          resolve(data.result as FulcrumBalance)
        }
      } catch (e) {
        cleanup()
        reject(e)
      }
    }

    ws.onerror = () => {
      cleanup()
      reject(new Error(`WebSocket error connecting to ${wssUrl}`))
    }

    ws.onclose = (ev) => {
      if (!ev.wasClean) {
        cleanup()
        reject(new Error(`WebSocket closed unexpectedly from ${wssUrl}`))
      }
    }
  })
}

/**
 * Fetches the confirmed + unconfirmed BCH balance for a given address
 * by querying public Fulcrum Electrum nodes directly via WSS or Watchtower.
 *
 * Falls back through multiple nodes.
 * CRITICAL: Throws an error if all network queries fail, so caller can retain
 * the last saved database balance instead of incorrectly overwriting it with 0.
 */
export async function fetchBchAddressInfo(
  address: string,
): Promise<BchAddressInfo> {
  const validated = normalizeAndValidateBchAddress(address)
  if (!validated.valid) throw new Error(validated.error)

  const isChipnet = validated.address.startsWith("bchtest:")

  let scripthash: string
  try {
    scripthash = await addressToElectrumScripthash(validated.address)
  } catch (err) {
    throw new Error(
      `Invalid address for scripthash: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  // Attempt 1: Query Electrum WSS nodes
  const wssNodes = isChipnet ? CHIPNET_WSS_NODES : MAINNET_WSS_NODES
  for (const node of wssNodes) {
    try {
      const balance = await queryFulcrumWss(node, scripthash)
      const totalSats = (balance.confirmed ?? 0) + (balance.unconfirmed ?? 0)
      return {
        address: validated.address,
        spendableSats: Math.max(0, Math.trunc(totalSats)),
      }
    } catch {
      // Try next node
    }
  }

  // Attempt 2: Fallback to Watchtower REST balance API
  try {
    const base = isChipnet
      ? "https://chipnet.watchtower.cash/api"
      : "https://watchtower.cash/api"
    const apiAddress = isChipnet
      ? validated.address
      : validated.address.replace(/^bitcoincash:/, "")
    const response = await fetch(`${base}/balance/bch/${apiAddress}/`, {
      headers: { Accept: "application/json" },
    })
    if (response.ok) {
      const data = (await response.json()) as {
        valid?: boolean
        spendable?: number
        balance?: number
      }
      if (data.valid) {
        const spendableBch = Number(data.spendable ?? data.balance ?? 0)
        const spendableSats = Math.max(0, Math.round(spendableBch * 1e8))
        return { address: validated.address, spendableSats }
      }
    }
  } catch {
    // Network query failed
  }

  // All network nodes and APIs failed — throw error so DB is NOT overwritten with 0!
  throw new Error(
    "Unable to reach BCH live balance servers. Keeping last saved balance.",
  )
}

/**
 * No-op kept for call-site compatibility.
 * Direct Electrum WSS querying replaces the old Watchtower subscription model.
 */
export async function subscribeAddressToWatchtower(
  _address: string,
): Promise<void> {
  // No longer needed — we query Electrum nodes directly via WebSocket.
}
