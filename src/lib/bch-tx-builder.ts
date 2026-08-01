import {
  binToHex,
  decodeCashAddress,
  decodePrivateKeyWif,
  flattenBinArray,
  hexToBin,
  instantiateSecp256k1,
  instantiateSha256,
} from '@bitauth/libauth'

export type Utxo = {
  tx_hash: string
  tx_pos: number
  value: number
  height?: number
}

export type BroadcastResult = {
  success: boolean
  txid?: string
  error?: string
}

function numberToLEUint32(value: number): Uint8Array {
  const buf = new Uint8Array(4)
  const view = new DataView(buf.buffer)
  view.setUint32(0, value, true)
  return buf
}

function numberToLEUint64(value: number): Uint8Array {
  const buf = new Uint8Array(8)
  const view = new DataView(buf.buffer)
  const low = value % 0x100000000
  const high = Math.floor(value / 0x100000000)
  view.setUint32(0, low, true)
  view.setUint32(4, high, true)
  return buf
}

function hexToReversedBin(hex: string): Uint8Array {
  return hexToBin(hex).reverse()
}

export function addressToLockingScript(address: string): Uint8Array {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === 'string') throw new Error(`Invalid address ${address}: ${decoded}`)
  const pkh = decoded.payload as Uint8Array
  return new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac])
}

async function computeBip143Digest(
  sha256: { hash: (data: Uint8Array) => Uint8Array },
  version: number,
  outpointsBin: Uint8Array,
  sequencesBin: Uint8Array,
  inputOutpointBin: Uint8Array,
  inputLockingScript: Uint8Array,
  inputValueSats: number,
  inputSequence: number,
  outputsBin: Uint8Array,
  locktime: number,
  sighashType = 0x41,
): Promise<Uint8Array> {
  const doubleSha256 = (data: Uint8Array) => sha256.hash(sha256.hash(data))

  const hashPrevouts = doubleSha256(outpointsBin)
  const hashSequence = doubleSha256(sequencesBin)
  const hashOutputs = doubleSha256(outputsBin)

  const scriptCode = new Uint8Array([inputLockingScript.length, ...inputLockingScript])
  const sighashTypeBin = new Uint8Array([sighashType, 0, 0, 0])

  const serialization = flattenBinArray([
    numberToLEUint32(version),
    hashPrevouts,
    hashSequence,
    inputOutpointBin,
    scriptCode,
    numberToLEUint64(inputValueSats),
    numberToLEUint32(inputSequence),
    hashOutputs,
    numberToLEUint32(locktime),
    sighashTypeBin,
  ])

  return doubleSha256(serialization)
}

export async function buildSignedP2pkhTransaction(params: {
  privateKeyWif: string
  utxos: Utxo[]
  recipients: Array<{ address: string; amountSats: number }>
  minerFeeSats?: number
}): Promise<{ rawTxHex: string; txid: string; totalSpentSats: number }> {
  const minerFee = params.minerFeeSats ?? 500

  const decodedWif = decodePrivateKeyWif(params.privateKeyWif)
  if (typeof decodedWif === 'string') throw new Error(`Invalid WIF private key: ${decodedWif}`)
  const privateKey = decodedWif.privateKey

  const secp256k1 = await instantiateSecp256k1()
  const sha256 = await instantiateSha256()

  const pubKeyResult = secp256k1.derivePublicKeyCompressed(privateKey)
  if (typeof pubKeyResult === 'string') throw new Error(`Failed to derive public key: ${pubKeyResult}`)
  const pubKey = pubKeyResult

  const senderPkh = sha256.hash(pubKey)
  const senderLockingScript = new Uint8Array([0x76, 0xa9, 0x14, ...senderPkh, 0x88, 0xac])

  const totalNeededOut = params.recipients.reduce((sum, r) => sum + r.amountSats, 0)
  const totalRequired = totalNeededOut + minerFee

  let inputSats = 0
  const selectedUtxos: Utxo[] = []
  for (const utxo of params.utxos) {
    selectedUtxos.push(utxo)
    inputSats += utxo.value
    if (inputSats >= totalRequired) break
  }

  if (inputSats < totalRequired) {
    throw new Error(
      `Insufficient UTXO balance on-chain. Needed ${totalRequired} sats, found ${inputSats} sats.`,
    )
  }

  const changeSats = inputSats - totalRequired

  type TxOutput = { valueSats: number; lockingScript: Uint8Array }
  const outputs: TxOutput[] = []

  for (const r of params.recipients) {
    if (r.amountSats > 0) {
      outputs.push({
        valueSats: r.amountSats,
        lockingScript: addressToLockingScript(r.address),
      })
    }
  }

  if (changeSats >= 546) {
    outputs.push({
      valueSats: changeSats,
      lockingScript: senderLockingScript,
    })
  }

  const encodedOutputs: Uint8Array[] = outputs.map((out) => {
    return flattenBinArray([
      numberToLEUint64(out.valueSats),
      new Uint8Array([out.lockingScript.length]),
      out.lockingScript,
    ])
  })
  const outputsBin = flattenBinArray(encodedOutputs)

  const encodedOutpoints: Uint8Array[] = selectedUtxos.map((u) => {
    return flattenBinArray([hexToReversedBin(u.tx_hash), numberToLEUint32(u.tx_pos)])
  })
  const outpointsBin = flattenBinArray(encodedOutpoints)

  const encodedSequences: Uint8Array[] = selectedUtxos.map(() => numberToLEUint32(0xffffffff))
  const sequencesBin = flattenBinArray(encodedSequences)

  const txVersion = 2
  const locktime = 0
  const sighashType = 0x41

  const signedInputs: Uint8Array[] = []

  for (let i = 0; i < selectedUtxos.length; i += 1) {
    const utxo = selectedUtxos[i]
    const outpointBin = encodedOutpoints[i]

    const digest = await computeBip143Digest(
      sha256,
      txVersion,
      outpointsBin,
      sequencesBin,
      outpointBin,
      senderLockingScript,
      utxo.value,
      0xffffffff,
      outputsBin,
      locktime,
      sighashType,
    )

    const derSigResult = secp256k1.signMessageHashDER(privateKey, digest)
    if (typeof derSigResult === 'string') throw new Error(`Signing failed: ${derSigResult}`)
    const sigWithSighash = new Uint8Array([...derSigResult, sighashType])

    const unlockingScript = flattenBinArray([
      new Uint8Array([sigWithSighash.length]),
      sigWithSighash,
      new Uint8Array([pubKey.length]),
      pubKey,
    ])

    signedInputs.push(
      flattenBinArray([
        outpointBin,
        new Uint8Array([unlockingScript.length]),
        unlockingScript,
        numberToLEUint32(0xffffffff),
      ]),
    )
  }

  const rawTxBin = flattenBinArray([
    numberToLEUint32(txVersion),
    new Uint8Array([selectedUtxos.length]),
    flattenBinArray(signedInputs),
    new Uint8Array([outputs.length]),
    outputsBin,
    numberToLEUint32(locktime),
  ])

  const rawTxHex = binToHex(rawTxBin)
  const txidBin = sha256.hash(sha256.hash(rawTxBin)).reverse()
  const txid = binToHex(txidBin)

  return { rawTxHex, txid, totalSpentSats: totalNeededOut + minerFee }
}

const CHIPNET_WSS_NODES = [
  'wss://chipnet.bch.ninja:50004',
  'wss://chipnet.imaginary.cash:50004',
]

function queryFulcrumRpc<T>(
  wssUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = 8000,
): Promise<T> {
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
      const req = JSON.stringify({ id: 1, method, params }) + '\n'
      ws!.send(req)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        if (data.id === 1) {
          cleanup()
          if (data.error) return reject(new Error(data.error.message || 'Electrum RPC error'))
          resolve(data.result as T)
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

export async function fetchUtxos(address: string): Promise<Utxo[]> {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === 'string') throw new Error(`Invalid address ${address}`)
  const pkh = decoded.payload as Uint8Array
  const script = new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac])

  const sha256 = await instantiateSha256()
  const hashArr = sha256.hash(script).reverse()
  const scripthash = binToHex(hashArr)

  for (const node of CHIPNET_WSS_NODES) {
    try {
      const utxos = await queryFulcrumRpc<Utxo[]>(node, 'blockchain.scripthash.listunspent', [scripthash])
      if (Array.isArray(utxos)) return utxos
    } catch {
      // Try next node
    }
  }
  return []
}

export async function broadcastRawTransaction(rawTxHex: string): Promise<string> {
  for (const node of CHIPNET_WSS_NODES) {
    try {
      const txid = await queryFulcrumRpc<string>(node, 'blockchain.transaction.broadcast', [rawTxHex])
      if (typeof txid === 'string' && txid.length === 64) return txid
    } catch {
      // Try next node
    }
  }
  throw new Error('Failed to broadcast transaction to Chipnet network nodes.')
}

export async function executeOnChainBchRidePayment(params: {
  passengerWif: string
  passengerAddress: string
  driverAddress: string
  driverPayoutSats: number
  adminAddress?: string
  platformFeeSats: number
}): Promise<BroadcastResult> {
  try {
    const utxos = await fetchUtxos(params.passengerAddress)
    if (utxos.length === 0) {
      return { success: false, error: 'No unspent UTXOs found on-chain for passenger address.' }
    }

    const recipients: Array<{ address: string; amountSats: number }> = []

    if (params.driverAddress && params.driverPayoutSats > 546) {
      recipients.push({ address: params.driverAddress, amountSats: params.driverPayoutSats })
    }

    if (params.adminAddress && params.platformFeeSats > 546) {
      recipients.push({ address: params.adminAddress, amountSats: params.platformFeeSats })
    }

    if (recipients.length === 0) {
      return { success: false, error: 'No valid output recipients above dust limit.' }
    }

    const built = await buildSignedP2pkhTransaction({
      privateKeyWif: params.passengerWif,
      utxos,
      recipients,
      minerFeeSats: 500,
    })

    const txid = await broadcastRawTransaction(built.rawTxHex)
    return { success: true, txid }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
