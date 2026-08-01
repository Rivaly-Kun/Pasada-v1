import {
  binToHex,
  decodeCashAddress,
  decodePrivateKeyWif,
  hash160,
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

function providerFor(network: EscrowNetwork) {
  return new ElectrumNetworkProvider(network)
}

function contractFor(descriptor: EscrowDescriptor) {
  const provider = providerFor(descriptor.network)
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
): Promise<string> {
  const signer = signerForAddress(passengerWif, descriptor.passengerAddress)
  const { contract, provider } = contractFor(descriptor)
  if (contract.address !== descriptor.contractAddress) {
    throw new Error(
      "The escrow address does not match the ride contract parameters.",
    )
  }
  const utxos = await within(
    provider.getUtxos(descriptor.passengerAddress),
    15_000,
    "Timed out while reading the passenger BCH wallet.",
  )
  if (!utxos.length)
    throw new Error(
      "No spendable BCH UTXOs were found in the passenger wallet.",
    )

  const transaction = new TransactionBuilder({
    provider,
    maximumFeeSatoshis: BigInt(10_000),
  })
    .addInputs(utxos, signer.unlockP2PKH())
    .addOutput({ to: contract.address, amount: BigInt(descriptor.fundingSats) })
    .addBchChangeOutputIfNeeded({ to: descriptor.passengerAddress, feeRate: 1 })
  let tx
  try {
    tx = await within(
      transaction.send(),
      30_000,
      "The funding broadcast is still pending. Check the BCH escrow before retrying.",
    )
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("broadcast is still pending")
    ) {
      throw new EscrowBroadcastPendingError(error.message)
    }
    throw error
  }

  return tx.txid
}

export async function isEscrowFunded(
  descriptor: EscrowDescriptor,
): Promise<boolean> {
  const { contract } = contractFor(descriptor)
  const utxos = await within(
    contract.getUtxos(),
    15_000,
    "Timed out while checking the BCH escrow contract.",
  )
  return (
    utxos.length === 1 && utxos[0].satoshis === BigInt(descriptor.fundingSats)
  )
}

export async function settleEscrow(
  descriptor: EscrowDescriptor,
  driverWif: string,
): Promise<string> {
  const signer = signerForAddress(driverWif, descriptor.driverAddress)
  const { contract, provider } = contractFor(descriptor)
  const utxos = await contract.getUtxos()
  if (
    utxos.length !== 1 ||
    utxos[0].satoshis !== BigInt(descriptor.fundingSats)
  ) {
    throw new Error(
      "The ride escrow UTXO is unavailable or no longer matches its funded amount.",
    )
  }

  const tx = await new TransactionBuilder({
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
    .send()

  return tx.txid
}

export async function refundEscrow(
  descriptor: EscrowDescriptor,
  passengerWif: string,
): Promise<string> {
  const signer = signerForAddress(passengerWif, descriptor.passengerAddress)
  const { contract, provider } = contractFor(descriptor)
  const utxos = await contract.getUtxos()
  if (
    utxos.length !== 1 ||
    utxos[0].satoshis !== BigInt(descriptor.fundingSats)
  ) {
    throw new Error(
      "The ride escrow UTXO is unavailable or no longer matches its funded amount.",
    )
  }

  const refundSats = descriptor.fundingSats - descriptor.releaseFeeSats
  const tx = await new TransactionBuilder({
    provider,
    maximumFeeSatoshis: BigInt(descriptor.releaseFeeSats),
  })
    .addInput(utxos[0], contract.unlock.refund(signer))
    .addOutput({ to: descriptor.passengerAddress, amount: BigInt(refundSats) })
    .send()

  return tx.txid
}
