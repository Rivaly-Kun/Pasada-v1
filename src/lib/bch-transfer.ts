import {
  binToHex,
  decodeCashAddress,
  decodePrivateKeyWif,
  hash256,
  hexToBin,
  privateKeyToP2pkhCashAddress,
} from "@bitauth/libauth"
import {
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type Network,
  type Utxo,
} from "cashscript"
import { normalizeAndValidateBchAddress } from "./bch-wallet"

export const BCH_SEND_DUST_SATS = 546
export const BCH_SEND_FEE_RESERVE_SATS = 1_000

type SendNetwork = Extract<Network, "chipnet" | "mainnet">

const ELECTRUM_HOSTS: Record<SendNetwork, readonly string[]> = {
  chipnet: ["chipnet.bch.ninja", "chipnet.imaginary.cash"],
  mainnet: ["bch.imaginary.cash"],
}

function within<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

function addressNetwork(address: string): SendNetwork {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === "string") throw new Error("Enter a valid BCH address.")
  if (decoded.prefix === "bchtest") return "chipnet"
  if (decoded.prefix === "bitcoincash") return "mainnet"
  throw new Error("PASADA supports bchtest: and bitcoincash: addresses only.")
}

function signerForAddress(privateKeyWif: string, address: string) {
  const decodedWif = decodePrivateKeyWif(privateKeyWif)
  const decodedAddress = decodeCashAddress(address)
  if (typeof decodedWif === "string" || typeof decodedAddress === "string") {
    throw new Error("The PASADA wallet signing key is invalid.")
  }
  const derivedAddress = privateKeyToP2pkhCashAddress({
    privateKey: decodedWif.privateKey,
    prefix: decodedAddress.prefix,
  }).address
  if (derivedAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error("The local signing key does not control this BCH wallet.")
  }
  return new SignatureTemplate(privateKeyWif)
}

function rawTransactionId(rawTxHex: string) {
  return binToHex(hash256(hexToBin(rawTxHex)).reverse())
}

function isAlreadySubmitted(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /already (?:been )?(?:submitted|known|in (?:the )?mempool|in block chain)|txn-already-known/i.test(
    message,
  )
}

export function parseBchAmountToSats(value: string): number {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{0,8})?$/.test(normalized)) {
    throw new Error("Enter a BCH amount with no more than 8 decimal places.")
  }
  const [whole, decimal = ""] = normalized.split(".")
  const sats =
    Number.parseInt(whole, 10) * 100_000_000 +
    Number.parseInt(decimal.padEnd(8, "0") || "0", 10)
  if (!Number.isSafeInteger(sats) || sats < BCH_SEND_DUST_SATS) {
    throw new Error("Send at least 0.00000546 BCH (546 sats).")
  }
  return sats
}

export function validateBchTransfer(params: {
  senderAddress: string
  recipientAddress: string
  amountSats: number
  availableSats?: number
}) {
  const sender = normalizeAndValidateBchAddress(params.senderAddress)
  if (!sender.valid) throw new Error(sender.error)
  const recipient = normalizeAndValidateBchAddress(params.recipientAddress)
  if (!recipient.valid) throw new Error(recipient.error)
  if (addressNetwork(sender.address) !== addressNetwork(recipient.address)) {
    throw new Error("The recipient must use the same BCH network as your wallet.")
  }
  if (sender.address.toLowerCase() === recipient.address.toLowerCase()) {
    throw new Error("Enter another person's BCH address, not your own address.")
  }
  if (
    params.availableSats !== undefined &&
    params.amountSats + BCH_SEND_FEE_RESERVE_SATS > params.availableSats
  ) {
    throw new Error("Your wallet does not have enough BCH for this amount and its network fee.")
  }
  return { senderAddress: sender.address, recipientAddress: recipient.address }
}

export async function sendBchTransfer(params: {
  privateKeyWif: string
  senderAddress: string
  recipientAddress: string
  amountSats: number
}): Promise<{ txid: string; amountSats: number }> {
  const validated = validateBchTransfer(params)
  const network = addressNetwork(validated.senderAddress)
  const signer = signerForAddress(params.privateKeyWif, validated.senderAddress)
  const providers = ELECTRUM_HOSTS[network].map(
    (hostname) => new ElectrumNetworkProvider(network, { hostname }),
  )

  let spendableUtxos: Utxo[] = []
  let buildProvider: ElectrumNetworkProvider | null = null
  let lastError: unknown
  for (const provider of providers) {
    try {
      const utxos = await within(
        provider.getUtxos(validated.senderAddress),
        15_000,
        "Timed out while reading your BCH wallet.",
      )
      spendableUtxos = utxos.filter((utxo) => !utxo.token)
      buildProvider = provider
      if (spendableUtxos.length) break
    } catch (error) {
      lastError = error
    }
  }
  if (!buildProvider || !spendableUtxos.length) {
    if (lastError && !buildProvider) {
      throw new Error("PASADA could not reach the BCH network. Please try again.")
    }
    throw new Error("No spendable BCH was found in this wallet.")
  }

  const onChainSats = spendableUtxos.reduce(
    (sum, utxo) => sum + Number(utxo.satoshis),
    0,
  )
  if (params.amountSats + BCH_SEND_FEE_RESERVE_SATS > onChainSats) {
    throw new Error("Your on-chain balance is too low for this amount and its network fee.")
  }

  const transaction = new TransactionBuilder({
    provider: buildProvider,
    maximumFeeSatoshis: BigInt(10_000),
  })
    .addInputs(spendableUtxos, signer.unlockP2PKH())
    .addOutput({
      to: validated.recipientAddress,
      amount: BigInt(params.amountSats),
    })
    .addBchChangeOutputIfNeeded({
      to: validated.senderAddress,
      feeRate: 1,
    })

  transaction.debug()
  const rawTxHex = transaction.build()
  const expectedTxid = rawTransactionId(rawTxHex)
  lastError = undefined
  for (const provider of providers) {
    try {
      const txid = await within(
        provider.sendRawTransaction(rawTxHex),
        15_000,
        "Timed out while broadcasting the BCH transaction.",
      )
      return { txid: txid || expectedTxid, amountSats: params.amountSats }
    } catch (error) {
      if (isAlreadySubmitted(error)) {
        return { txid: expectedTxid, amountSats: params.amountSats }
      }
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The BCH transaction could not be broadcast.")
}
