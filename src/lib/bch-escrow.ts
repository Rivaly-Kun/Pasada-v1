import {
  binToHex,
  decodeCashAddress,
  decodePrivateKeyWif,
  hash160,
  hash256,
  hexToBin,
  privateKeyToP2pkhCashAddress,
} from "@bitauth/libauth"
import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type Network,
} from "cashscript"
import PasadaEscrowArtifact from "../contracts/PasadaEscrow.json"

export const ESCROW_RELEASE_FEE_SATS = 1_000
export const ESCROW_FUNDING_FEE_RESERVE_SATS = 1_000

export class EscrowBroadcastPendingError extends Error {}

export type EscrowNetwork = Extract<Network, "chipnet" | "mainnet">
// CashScript defaults to one Electrum server per network. Keeping a second
// Chipnet endpoint avoids making a live ride depend on a single WebSocket.
const ESCROW_ELECTRUM_HOSTS: Record<EscrowNetwork, readonly string[]> = {
  chipnet: ["chipnet.bch.ninja", "chipnet.imaginary.cash"],
  mainnet: ["bch.imaginary.cash"],
}

export type EscrowDescriptor = {
  contractAddress: string
  network: EscrowNetwork
  passengerAddress: string
  driverAddress: string
  platformAddress: string
  passengerPublicKey: string
  driverPublicKey: string
  passengerPkh: string
  driverPkh: string
  platformPkh: string
  driverPayoutSats: number
  platformFeeSats: number
  releaseFeeSats: number
  fundingSats: number
}

export type EscrowCouponRedemption = {
  categoryId: string
  amount: 1
  passengerTokenAddress: string
  redemptionTokenAddress: string
  tokenDustSats: number
}

type EscrowParticipants = {
  passengerAddress: string
  passengerPublicKey: string
  driverAddress: string
  driverPublicKey: string
  platformAddress: string
  driverPayoutSats: number
  platformFeeSats: number
}

function within<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

function addressNetwork(address: string): EscrowNetwork {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === "string")
    throw new Error("A valid BCH address is required for escrow.")
  if (decoded.prefix === "bchtest") return "chipnet"
  if (decoded.prefix === "bitcoincash") return "mainnet"
  throw new Error(
    "PASADA escrow supports bchtest: (Chipnet) and bitcoincash: addresses only.",
  )
}

function publicKeyHash(address: string): string {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === "string" || decoded.payload.length !== 20) {
    throw new Error("Escrow requires a standard P2PKH BCH address.")
  }
  return binToHex(decoded.payload)
}

function signerForAddress(
  privateKeyWif: string,
  address: string,
): SignatureTemplate {
  const decodedWif = decodePrivateKeyWif(privateKeyWif)
  if (typeof decodedWif === "string")
    throw new Error("The linked BCH wallet key is invalid.")
  const decodedAddress = decodeCashAddress(address)
  if (typeof decodedAddress === "string")
    throw new Error("The linked BCH address is invalid.")
  const derived = privateKeyToP2pkhCashAddress({
    privateKey: decodedWif.privateKey,
    prefix: decodedAddress.prefix,
  }).address
  if (derived.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      "The linked BCH signing key does not control the displayed wallet address.",
    )
  }
  return new SignatureTemplate(privateKeyWif)
}

/** Exposes only the public key required to construct a passenger's escrow. */
export function publicKeyForAddress(
  privateKeyWif: string,
  address: string,
): string {
  return binToHex(signerForAddress(privateKeyWif, address).getPublicKey())
}

function verifiedPublicKeyForAddress(
  publicKey: string,
  address: string,
): string {
  const normalized = publicKey.trim().toLowerCase()
  if (!/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("The passenger wallet did not provide a valid public key.")
  }
  if (binToHex(hash160(hexToBin(normalized))) !== publicKeyHash(address)) {
    throw new Error(
      "The passenger escrow public key does not match the displayed BCH address.",
    )
  }
  return normalized
}
function providerFor(network: EscrowNetwork, hostname?: string) {
  return hostname
    ? new ElectrumNetworkProvider(network, { hostname })
    : new ElectrumNetworkProvider(network)
}

function contractFor(
  descriptor: EscrowDescriptor,
  provider = providerFor(descriptor.network),
) {
  const contract = new Contract(
    PasadaEscrowArtifact,
    [
      descriptor.passengerPublicKey,
      descriptor.driverPublicKey,
      descriptor.passengerPkh,
      descriptor.driverPkh,
      descriptor.platformPkh,
      BigInt(descriptor.driverPayoutSats),
      BigInt(descriptor.platformFeeSats),
      BigInt(descriptor.releaseFeeSats),
    ],
    { provider, contractType: "p2sh32" },
  )
  return { contract, provider }
}
function rawTransactionId(rawTxHex: string): string {
  return binToHex(hash256(hexToBin(rawTxHex)).reverse())
}
function isAlreadySubmitted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /already (?:been )?(?:submitted|known|in (?:the )?mempool|in block chain)/i.test(
    message,
  )
}
/**
 * CashScript's `send()` fetches the transaction from the Electrum server after
 * broadcasting it. That lookup can take up to ten minutes, so it is the wrong
 * completion signal for an interactive ride flow. We still locally evaluate
 * the built transaction, then persist the txid returned by broadcast itself.
 */
async function buildAndBroadcast(
  transaction: TransactionBuilder,
  provider: ElectrumNetworkProvider,
  timeoutMs = 15_000,
): Promise<string> {
  transaction.debug()
  const rawTxHex = transaction.build()
  const expectedTxid = rawTransactionId(rawTxHex)
  try {
    const broadcastTxid = await within(
      provider.sendRawTransaction(rawTxHex),
      timeoutMs,
      "Timed out while broadcasting the BCH transaction.",
    )
    return broadcastTxid || expectedTxid
  } catch (error) {
    // A retry after a lost WebSocket response is still a successful broadcast.
    if (isAlreadySubmitted(error)) return expectedTxid
    throw error
  }
}
async function fundedEscrowTxidForContract(
  descriptor: EscrowDescriptor,
  contract: Contract,
): Promise<string | null> {
  const utxos = await within(
    contract.getUtxos(),
    15_000,
    "Timed out while checking the BCH escrow contract.",
  )
  const fundedUtxo =
    utxos.length === 1 && utxos[0].satoshis === BigInt(descriptor.fundingSats)
      ? utxos[0]
      : null
  return fundedUtxo?.txid ?? null
}
export async function getEscrowFundingTxid(
  descriptor: EscrowDescriptor,
): Promise<string | null> {
  let lastError: unknown
  for (const hostname of ESCROW_ELECTRUM_HOSTS[descriptor.network]) {
    try {
      const { contract } = contractFor(
        descriptor,
        providerFor(descriptor.network, hostname),
      )
      const txid = await fundedEscrowTxidForContract(descriptor, contract)
      if (txid) return txid
    } catch (error) {
      lastError = error
    }
  }
  if (lastError) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Unable to reach a BCH escrow provider.")
  }
  return null
}

export function prepareEscrowDescriptor(
  participants: EscrowParticipants,
): EscrowDescriptor {
  const network = addressNetwork(participants.passengerAddress)
  if (
    addressNetwork(participants.driverAddress) !== network ||
    addressNetwork(participants.platformAddress) !== network
  ) {
    throw new Error(
      "Passenger, driver, and PASADA platform wallets must use the same BCH network.",
    )
  }
  if (
    participants.driverPayoutSats < 546 ||
    participants.platformFeeSats < 546
  ) {
    throw new Error(
      "The ride split is below the BCH dust minimum and cannot be escrowed.",
    )
  }

  const descriptor: EscrowDescriptor = {
    contractAddress: "",
    network,
    passengerAddress: participants.passengerAddress,
    driverAddress: participants.driverAddress,
    platformAddress: participants.platformAddress,
    passengerPublicKey: verifiedPublicKeyForAddress(
      participants.passengerPublicKey,
      participants.passengerAddress,
    ),
    driverPublicKey: verifiedPublicKeyForAddress(
      participants.driverPublicKey,
      participants.driverAddress,
    ),
    passengerPkh: publicKeyHash(participants.passengerAddress),
    driverPkh: publicKeyHash(participants.driverAddress),
    platformPkh: publicKeyHash(participants.platformAddress),
    driverPayoutSats: Math.trunc(participants.driverPayoutSats),
    platformFeeSats: Math.trunc(participants.platformFeeSats),
    releaseFeeSats: ESCROW_RELEASE_FEE_SATS,
    fundingSats:
      Math.trunc(participants.driverPayoutSats) +
      Math.trunc(participants.platformFeeSats) +
      ESCROW_RELEASE_FEE_SATS,
  }
  const { contract } = contractFor(descriptor)
  return { ...descriptor, contractAddress: contract.address }
}

export async function fundEscrow(
  descriptor: EscrowDescriptor,
  passengerWif: string,
  coupon?: EscrowCouponRedemption,
): Promise<string> {
  const signer = signerForAddress(passengerWif, descriptor.passengerAddress)
  let lastError: unknown
  for (const hostname of ESCROW_ELECTRUM_HOSTS[descriptor.network]) {
    const provider = providerFor(descriptor.network, hostname)
    const { contract } = contractFor(descriptor, provider)
    if (contract.address !== descriptor.contractAddress) {
      throw new Error(
        "The escrow address does not match the ride contract parameters.",
      )
    }
    try {
      const utxos = await within(
        provider.getUtxos(descriptor.passengerAddress),
        15_000,
        "Timed out while reading the passenger BCH wallet.",
      )
      if (!utxos.length)
        throw new Error(
          "No spendable BCH UTXOs were found in the passenger wallet.",
        )
      const plainBchUtxos = utxos.filter((utxo) => !utxo.token)
      const couponUtxos = coupon
        ? utxos.filter((utxo) => utxo.token?.category === coupon.categoryId)
        : []
      if (coupon) {
        const availableCoupons = couponUtxos.reduce(
          (sum, utxo) => sum + Number(utxo.token?.amount ?? 0n),
          0,
        )
        if (availableCoupons < coupon.amount) {
          throw new Error(
            "This wallet no longer holds the PRC coupon reserved for the ride.",
          )
        }
        const passengerToken = decodeCashAddress(coupon.passengerTokenAddress)
        const redemptionToken = decodeCashAddress(coupon.redemptionTokenAddress)
        if (
          typeof passengerToken === "string" ||
          typeof redemptionToken === "string" ||
          passengerToken.type !== "p2pkhWithTokens" ||
          redemptionToken.type !== "p2pkhWithTokens" ||
          passengerToken.prefix !== "bchtest" ||
          redemptionToken.prefix !== "bchtest"
        ) {
          throw new Error(
            "The PRC redemption addresses are not token-aware Chipnet addresses.",
          )
        }
      }
      const selectedUtxos = coupon
        ? [...couponUtxos, ...plainBchUtxos]
        : plainBchUtxos
      if (!selectedUtxos.length) {
        throw new Error(
          "No spendable BCH UTXOs were found in the passenger wallet.",
        )
      }
      const transaction = new TransactionBuilder({
        provider,
        maximumFeeSatoshis: BigInt(10_000),
      })
        .addInputs(selectedUtxos, signer.unlockP2PKH())
        .addOutput({
          to: contract.address,
          amount: BigInt(descriptor.fundingSats),
        })
      if (coupon) {
        transaction
          .addOutput({
            to: coupon.redemptionTokenAddress,
            amount: BigInt(coupon.tokenDustSats),
            token: {
              category: coupon.categoryId,
              amount: BigInt(coupon.amount),
            },
          })
          .addTokenChangeOutputIfNeeded({
            category: coupon.categoryId,
            to: coupon.passengerTokenAddress,
          })
      }
      transaction.addBchChangeOutputIfNeeded({
        to: descriptor.passengerAddress,
        feeRate: 1,
      })
      return await buildAndBroadcast(transaction, provider)
    } catch (error) {
      lastError = error
      // The first node may have accepted the transaction but dropped the
      // response. Check the covenant before trying another broadcaster.
      const fundedTxid = await fundedEscrowTxidForContract(
        descriptor,
        contract,
      ).catch(() => null)
      if (fundedTxid) return fundedTxid
    }
  }
  if (
    lastError instanceof Error &&
    /timed out|websocket|connection|network/i.test(lastError.message)
  ) {
    throw new EscrowBroadcastPendingError(
      "The BCH funding broadcast is still being confirmed. PASADA will check the escrow automatically.",
    )
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to fund the BCH escrow.")
}

export async function isEscrowFunded(
  descriptor: EscrowDescriptor,
): Promise<boolean> {
  return Boolean(await getEscrowFundingTxid(descriptor))
}

export async function settleEscrow(
  descriptor: EscrowDescriptor,
  driverWif: string,
): Promise<string> {
  const signer = signerForAddress(driverWif, descriptor.driverAddress)
  let lastError: unknown
  for (const hostname of ESCROW_ELECTRUM_HOSTS[descriptor.network]) {
    const provider = providerFor(descriptor.network, hostname)
    const { contract } = contractFor(descriptor, provider)
    try {
      const utxos = await within(
        contract.getUtxos(),
        15_000,
        "Timed out while reading the BCH escrow contract.",
      )
      if (
        utxos.length !== 1 ||
        utxos[0].satoshis !== BigInt(descriptor.fundingSats)
      ) {
        throw new Error(
          "The ride escrow UTXO is unavailable or no longer matches its funded amount.",
        )
      }
      const transaction = new TransactionBuilder({
        provider,
        maximumFeeSatoshis: BigInt(descriptor.releaseFeeSats),
      })
        .addInput(utxos[0], contract.unlock.settle(signer))
        .addOutput({
          to: descriptor.driverAddress,
          amount: BigInt(descriptor.driverPayoutSats),
        })
        .addOutput({
          to: descriptor.platformAddress,
          amount: BigInt(descriptor.platformFeeSats),
        })
      return await buildAndBroadcast(transaction, provider)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to settle the BCH escrow.")
}

export async function refundEscrow(
  descriptor: EscrowDescriptor,
  passengerWif: string,
): Promise<string> {
  const signer = signerForAddress(passengerWif, descriptor.passengerAddress)

  const refundSats = descriptor.fundingSats - descriptor.releaseFeeSats
  let lastError: unknown
  for (const hostname of ESCROW_ELECTRUM_HOSTS[descriptor.network]) {
    const provider = providerFor(descriptor.network, hostname)
    const { contract } = contractFor(descriptor, provider)
    try {
      const utxos = await within(
        contract.getUtxos(),
        15_000,
        "Timed out while reading the BCH escrow contract.",
      )
      if (
        utxos.length !== 1 ||
        utxos[0].satoshis !== BigInt(descriptor.fundingSats)
      ) {
        throw new Error(
          "The ride escrow UTXO is unavailable or no longer matches its funded amount.",
        )
      }
      const transaction = new TransactionBuilder({
        provider,
        maximumFeeSatoshis: BigInt(descriptor.releaseFeeSats),
      })
        .addInput(utxos[0], contract.unlock.refund(signer))
        .addOutput({
          to: descriptor.passengerAddress,
          amount: BigInt(refundSats),
        })
      return await buildAndBroadcast(transaction, provider)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to refund the BCH escrow.")
}
