import {
  CashAddressType,
  binToHex,
  decodeCashAddress,
  decodePrivateKeyWif,
  encodeCashAddress,
  hash256,
  hexToBin,
  privateKeyToP2pkhCashAddress,
} from "@bitauth/libauth"
import {
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type Utxo,
} from "cashscript"
import {
  get,
  onValue,
  ref,
  runTransaction,
  update,
  type Unsubscribe,
} from "firebase/database"
import { getScopedFirebase, type FirebaseScope } from "./firebase"
import { normalizeAndValidateBchAddress } from "./bch-wallet"
import type {
  CashTokenActivity,
  CashTokenConfig,
  ReferralRewardClaim,
} from "./types"

export const PRC_NAME = "PASADA Referral Credit" as const
export const PRC_SYMBOL = "PRC" as const
export const PRC_INITIAL_SUPPLY = 10_000
export const PRC_COUPON_VALUE_PHP = 15
export const PRC_TOKEN_DUST_SATS = 1_000
const PRC_GENESIS_INPUT_SATS = 10_000
const TOKEN_MAX_FEE_SATS = 5_000
const TOKEN_HOSTS = ["chipnet.bch.ninja", "chipnet.imaginary.cash"] as const

export type CashTokenHubState = {
  config: CashTokenConfig | null
  activity: CashTokenActivity[]
  rewardClaims: ReferralRewardClaim[]
}

export type CashTokenWalletSnapshot = {
  bchSats: number
  tokenBalance: number
  tokenUtxos: number
}

function database(scope: FirebaseScope = "passenger") {
  return getScopedFirebase(scope).database
}

function within<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
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

function signerForAddress(privateKeyWif: string, address: string) {
  const validated = normalizeAndValidateBchAddress(address)
  if (!validated.valid || !validated.address.startsWith("bchtest:")) {
    throw new Error("PRC transactions require a standard Chipnet BCH address.")
  }
  const decodedWif = decodePrivateKeyWif(privateKeyWif)
  if (typeof decodedWif === "string") {
    throw new Error("The local PRC wallet signing key is invalid.")
  }
  const derived = privateKeyToP2pkhCashAddress({
    privateKey: decodedWif.privateKey,
    prefix: "bchtest",
  }).address
  if (derived.toLowerCase() !== validated.address.toLowerCase()) {
    throw new Error(
      "The local signing key does not control the PRC issuer wallet.",
    )
  }
  return new SignatureTemplate(privateKeyWif)
}

async function broadcast(
  transaction: TransactionBuilder,
  provider: ElectrumNetworkProvider,
) {
  const rawTxHex = transaction.build()
  const expectedTxid = rawTransactionId(rawTxHex)
  try {
    const txid = await within(
      provider.sendRawTransaction(rawTxHex),
      15_000,
      "Timed out while broadcasting the CashToken transaction.",
    )
    return txid || expectedTxid
  } catch (error) {
    if (isAlreadySubmitted(error)) return expectedTxid
    throw error
  }
}

async function providerAndUtxos(address: string) {
  let lastError: unknown
  for (const hostname of TOKEN_HOSTS) {
    const provider = new ElectrumNetworkProvider("chipnet", { hostname })
    try {
      const utxos = await within(
        provider.getUtxos(address),
        15_000,
        "Timed out while reading the Chipnet CashToken wallet.",
      )
      return { provider, utxos }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("PASADA could not reach a Chipnet CashToken provider.")
}

export function deriveTokenAddress(cashAddress: string): string {
  const validated = normalizeAndValidateBchAddress(cashAddress)
  if (!validated.valid) throw new Error(validated.error)
  const decoded = decodeCashAddress(validated.address)
  if (typeof decoded === "string" || decoded.payload.length !== 20) {
    throw new Error("PRC requires a standard P2PKH BCH address.")
  }
  if (decoded.prefix !== "bchtest") {
    throw new Error("PRC is available on BCH Chipnet only.")
  }
  if (decoded.type === CashAddressType.p2pkhWithTokens) return validated.address
  if (decoded.type !== CashAddressType.p2pkh) {
    throw new Error("PRC requires a P2PKH BCH wallet.")
  }
  return encodeCashAddress({
    prefix: "bchtest",
    type: CashAddressType.p2pkhWithTokens,
    payload: decoded.payload,
  }).address
}

export function createReferralCode(displayName: string, uid: string): string {
  const namePart = displayName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 2)
    .padEnd(2, "X")
  let uidHash = 0x811c9dc5
  for (const character of uid) {
    uidHash ^= character.charCodeAt(0)
    uidHash = Math.imul(uidHash, 0x01000193)
  }
  const uidPart = (uidHash >>> 0)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0")
    .slice(-4)
  const suffix = `${namePart}${uidPart}`
  return `PASADA-${suffix}`
}

export function normalizeReferralCode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "")
  if (!compact) return ""
  return compact.startsWith("PASADA-") ? compact : `PASADA-${compact}`
}

export async function resolveReferralCode(value: string) {
  const code = normalizeReferralCode(value)
  if (!code) return null
  const snapshot = await get(
    ref(database("passenger"), `referralCodes/${code}`),
  )
  if (!snapshot.exists()) {
    throw new Error("That PASADA referral code was not found.")
  }
  return snapshot.val() as {
    uid: string
    displayName: string
    email?: string
    tokenAddress: string
    code: string
  }
}

export async function fetchCashTokenWalletSnapshot(
  cashAddress: string,
  categoryId?: string,
): Promise<CashTokenWalletSnapshot> {
  const tokenAddress = deriveTokenAddress(cashAddress)
  const { utxos } = await providerAndUtxos(tokenAddress)
  return {
    bchSats: utxos.reduce((sum, utxo) => sum + Number(utxo.satoshis), 0),
    tokenBalance: utxos.reduce(
      (sum, utxo) =>
        sum +
        (utxo.token && (!categoryId || utxo.token.category === categoryId)
          ? Number(utxo.token.amount)
          : 0),
      0,
    ),
    tokenUtxos: utxos.filter(
      (utxo) =>
        utxo.token && (!categoryId || utxo.token.category === categoryId),
    ).length,
  }
}

export async function mintReferralTokenCategory(params: {
  issuerAddress: string
  privateKeyWif: string
}): Promise<{
  categoryId: string
  preGenesisTxid: string
  genesisTxid: string
  issuerTokenAddress: string
}> {
  const issuerAddress = normalizeAndValidateBchAddress(params.issuerAddress)
  if (!issuerAddress.valid || !issuerAddress.address.startsWith("bchtest:")) {
    throw new Error("The PRC issuer must be a standard Chipnet wallet.")
  }
  const signer = signerForAddress(params.privateKeyWif, issuerAddress.address)
  const issuerTokenAddress = deriveTokenAddress(issuerAddress.address)
  const { provider, utxos } = await providerAndUtxos(issuerAddress.address)
  const bchUtxos = utxos.filter((utxo) => !utxo.token)
  const availableSats = bchUtxos.reduce(
    (sum, utxo) => sum + Number(utxo.satoshis),
    0,
  )
  if (availableSats < PRC_GENESIS_INPUT_SATS + TOKEN_MAX_FEE_SATS) {
    throw new Error(
      `Fund the issuer wallet with at least ${(PRC_GENESIS_INPUT_SATS + TOKEN_MAX_FEE_SATS).toLocaleString()} sats before initializing PRC.`,
    )
  }

  // CashTokens categories must be created from input 0 spending a vout-0 UTXO.
  // This setup transaction deterministically creates that genesis outpoint.
  const preGenesis = new TransactionBuilder({
    provider,
    maximumFeeSatoshis: BigInt(TOKEN_MAX_FEE_SATS),
  })
    .addInputs(bchUtxos, signer.unlockP2PKH())
    .addOutput({
      to: issuerAddress.address,
      amount: BigInt(PRC_GENESIS_INPUT_SATS),
    })
    .addBchChangeOutputIfNeeded({ to: issuerAddress.address, feeRate: 1 })
  const preGenesisTxid = await broadcast(preGenesis, provider)

  const genesisInput: Utxo = {
    txid: preGenesisTxid,
    vout: 0,
    satoshis: BigInt(PRC_GENESIS_INPUT_SATS),
  }
  const genesis = new TransactionBuilder({
    provider,
    maximumFeeSatoshis: BigInt(TOKEN_MAX_FEE_SATS),
  })
    .addInput(genesisInput, signer.unlockP2PKH())
    .addOutput({
      to: issuerTokenAddress,
      amount: BigInt(PRC_TOKEN_DUST_SATS),
      token: {
        category: preGenesisTxid,
        amount: BigInt(PRC_INITIAL_SUPPLY),
      },
    })
    .addBchChangeOutputIfNeeded({ to: issuerAddress.address, feeRate: 1 })
  const genesisTxid = await broadcast(genesis, provider)
  return {
    categoryId: preGenesisTxid,
    preGenesisTxid,
    genesisTxid,
    issuerTokenAddress,
  }
}

async function transferToken(params: {
  senderAddress: string
  senderTokenAddress: string
  recipientTokenAddress: string
  privateKeyWif: string
  categoryId: string
  amount: number
}) {
  const signer = signerForAddress(params.privateKeyWif, params.senderAddress)
  const { provider, utxos } = await providerAndUtxos(params.senderTokenAddress)
  const tokenUtxos = utxos.filter(
    (utxo) => utxo.token?.category === params.categoryId,
  )
  const tokenBalance = tokenUtxos.reduce(
    (sum, utxo) => sum + Number(utxo.token?.amount ?? 0n),
    0,
  )
  if (tokenBalance < params.amount) {
    throw new Error(`This wallet does not hold enough ${PRC_SYMBOL} tokens.`)
  }
  const bchUtxos = utxos.filter((utxo) => !utxo.token)
  if (!bchUtxos.length) {
    throw new Error(
      "The token wallet needs BCH satoshis for dust outputs and its miner fee.",
    )
  }
  const transaction = new TransactionBuilder({
    provider,
    maximumFeeSatoshis: BigInt(TOKEN_MAX_FEE_SATS),
  })
    .addInputs([...tokenUtxos, ...bchUtxos], signer.unlockP2PKH())
    .addOutput({
      to: params.recipientTokenAddress,
      amount: BigInt(PRC_TOKEN_DUST_SATS),
      token: {
        category: params.categoryId,
        amount: BigInt(params.amount),
      },
    })
    .addTokenChangeOutputIfNeeded({
      category: params.categoryId,
      to: params.senderTokenAddress,
    })
    .addBchChangeOutputIfNeeded({ to: params.senderAddress, feeRate: 1 })
  return broadcast(transaction, provider)
}

export async function transferReferralCredit(params: {
  issuerAddress: string
  privateKeyWif: string
  recipientTokenAddress: string
  categoryId: string
  amount?: number
}) {
  return transferToken({
    senderAddress: params.issuerAddress,
    senderTokenAddress: deriveTokenAddress(params.issuerAddress),
    recipientTokenAddress: params.recipientTokenAddress,
    privateKeyWif: params.privateKeyWif,
    categoryId: params.categoryId,
    amount: params.amount ?? 1,
  })
}

export async function redeemReferralCredit(params: {
  passengerAddress: string
  privateKeyWif: string
  redemptionTokenAddress: string
  categoryId: string
}) {
  return transferToken({
    senderAddress: params.passengerAddress,
    senderTokenAddress: deriveTokenAddress(params.passengerAddress),
    recipientTokenAddress: params.redemptionTokenAddress,
    privateKeyWif: params.privateKeyWif,
    categoryId: params.categoryId,
    amount: 1,
  })
}

export async function initializePrcToken(params: {
  issuerAddress: string
  privateKeyWif: string
}): Promise<CashTokenConfig> {
  const admin = getScopedFirebase("admin").auth.currentUser
  if (!admin)
    throw new Error("Log in as an administrator before initializing PRC.")
  const current = await get(ref(database("admin"), "platform/cashtoken/config"))
  if (current.exists() && current.val()?.categoryId) {
    throw new Error("PASADA Referral Credit has already been initialized.")
  }
  const minted = await mintReferralTokenCategory(params)
  const now = Date.now()
  const config: CashTokenConfig = {
    network: "chipnet",
    name: PRC_NAME,
    symbol: PRC_SYMBOL,
    categoryId: minted.categoryId,
    totalSupply: PRC_INITIAL_SUPPLY,
    couponValuePhp: PRC_COUPON_VALUE_PHP,
    maxCouponsPerRide: 1,
    issuerAddress: params.issuerAddress,
    issuerTokenAddress: minted.issuerTokenAddress,
    redemptionTokenAddress: minted.issuerTokenAddress,
    preGenesisTxid: minted.preGenesisTxid,
    genesisTxid: minted.genesisTxid,
    initializedAt: now,
    initializedBy: admin.uid,
  }
  const activity: CashTokenActivity = {
    id: `genesis_${minted.genesisTxid}`,
    type: "genesis",
    status: "confirmed",
    amount: PRC_INITIAL_SUPPLY,
    txid: minted.genesisTxid,
    createdAt: now,
    updatedAt: now,
  }
  await update(ref(database("admin")), {
    "platform/cashtoken/config": config,
    [`platform/cashtoken/activity/${activity.id}`]: activity,
    [`adminAudit/${now}_prc_genesis`]: {
      action: "prc_genesis_initialized",
      categoryId: config.categoryId,
      genesisTxid: config.genesisTxid,
      adminUid: admin.uid,
      createdAt: now,
    },
  })
  return config
}

export function subscribeCashTokenHub(
  onState: (state: CashTokenHubState) => void,
  scope: FirebaseScope = "passenger",
): Unsubscribe {
  return onValue(ref(database(scope), "platform/cashtoken"), (snapshot) => {
    const value = (snapshot.val() ?? {}) as {
      config?: CashTokenConfig
      activity?: Record<string, CashTokenActivity>
      rewardClaims?: Record<string, ReferralRewardClaim>
    }
    onState({
      config: value.config?.categoryId ? value.config : null,
      activity: Object.values(value.activity ?? {}).sort(
        (left, right) => right.createdAt - left.createdAt,
      ),
      rewardClaims: Object.values(value.rewardClaims ?? {}).sort(
        (left, right) => right.createdAt - left.createdAt,
      ),
    })
  })
}

export async function queueReferralRewardForSettledRide(params: {
  rideId: string
  passengerId: string
  passengerName: string
}) {
  const db = database("driver")
  const passengerSnapshot = await get(
    ref(db, `passengers/${params.passengerId}`),
  )
  const passenger = passengerSnapshot.val() as Record<string, unknown> | null
  const referrerUid = String(passenger?.referredByUid ?? "")
  const referrerCode = String(passenger?.referredByCode ?? "")
  if (!referrerUid || !referrerCode) return false

  const ridesSnapshot = await get(ref(db, "rides"))
  const settledRides = Object.entries(
    (ridesSnapshot.val() ?? {}) as Record<string, Record<string, unknown>>,
  )
    .filter(
      ([, ride]) =>
        String(ride.passengerId ?? "") === params.passengerId &&
        String(ride.status ?? "") === "settled",
    )
    .sort(([leftId, left], [rightId, right]) => {
      const leftAt = Number(
        left.settledAt ?? left.updatedAt ?? left.createdAt ?? 0,
      )
      const rightAt = Number(
        right.settledAt ?? right.updatedAt ?? right.createdAt ?? 0,
      )
      return leftAt - rightAt || leftId.localeCompare(rightId)
    })
  if (!settledRides.length || settledRides[0][0] !== params.rideId) {
    return false
  }

  const referrerSnapshot = await get(ref(db, `passengers/${referrerUid}`))
  const referrer = referrerSnapshot.val() as Record<string, unknown> | null
  if (!referrer) return false
  const referrerAddress = String(referrer.bchAddress ?? "")
  const savedTokenAddress = String(referrer.chipnetTokenAddress ?? "")
  const referrerTokenAddress =
    savedTokenAddress || deriveTokenAddress(referrerAddress)
  const now = Date.now()
  const claimId = params.passengerId
  const claim: ReferralRewardClaim = {
    id: claimId,
    referredPassengerId: params.passengerId,
    referredPassengerName: params.passengerName,
    referredPassengerEmail: String(passenger?.email ?? "") || undefined,
    referrerUid,
    referrerName: String(referrer.displayName ?? "PASADA passenger"),
    referrerEmail: String(referrer.email ?? "") || undefined,
    referrerCode,
    referrerTokenAddress,
    source: "signup_referral",
    rideId: params.rideId,
    amount: 1,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }
  let created = false
  const reserved = await runTransaction(
    ref(db, `platform/cashtoken/rewardClaims/${claimId}`),
    (current: ReferralRewardClaim | null) => {
      if (current) {
        created = false
        return
      }
      created = true
      return claim
    },
  )
  if (!reserved.committed || !created) return false
  const activity: CashTokenActivity = {
    id: `reward_${claimId}`,
    type: "referral_reward",
    status: "pending",
    amount: 1,
    rideId: params.rideId,
    referrerUid,
    referrerName: claim.referrerName,
    referredPassengerId: params.passengerId,
    referredPassengerName: params.passengerName,
    createdAt: now,
    updatedAt: now,
  }
  await update(ref(db), {
    [`platform/cashtoken/activity/${activity.id}`]: activity,
    [`passengers/${params.passengerId}/referralQualified`]: true,
    [`passengers/${params.passengerId}/referralQualifiedRideId`]: params.rideId,
  })
  return true
}

/**
 * A valid referral creates an entitlement immediately at signup. It remains
 * pending until an administrator deliberately sends a real PRC CashToken.
 */
export async function queueReferralRewardForReferralSignup(params: {
  passengerId: string
  passengerName: string
  passengerEmail: string
  referrer: {
    uid: string
    displayName: string
    email?: string
    tokenAddress: string
    code: string
  }
}) {
  const db = database("passenger")
  const now = Date.now()
  const claimId = `signup_${params.passengerId}`
  const claim: ReferralRewardClaim = {
    id: claimId,
    referredPassengerId: params.passengerId,
    referredPassengerName: params.passengerName,
    referredPassengerEmail: params.passengerEmail,
    referrerUid: params.referrer.uid,
    referrerName: params.referrer.displayName,
    referrerEmail: params.referrer.email,
    referrerCode: params.referrer.code,
    referrerTokenAddress: params.referrer.tokenAddress,
    source: "signup_referral",
    amount: 1,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }
  const reserved = await runTransaction(
    ref(db, `platform/cashtoken/rewardClaims/${claimId}`),
    (current: ReferralRewardClaim | null) => current ?? claim,
  )
  if (!reserved.committed) return false
  const activity: CashTokenActivity = {
    id: `reward_${claimId}`,
    type: "referral_reward",
    status: "pending",
    amount: 1,
    referrerUid: claim.referrerUid,
    referrerName: claim.referrerName,
    referredPassengerId: claim.referredPassengerId,
    referredPassengerName: claim.referredPassengerName,
    createdAt: now,
    updatedAt: now,
  }
  await update(ref(db), {
    [`platform/cashtoken/activity/${activity.id}`]: activity,
    [`passengers/${params.passengerId}/referralQualified`]: true,
    [`passengers/${params.passengerId}/referralQualifiedAt`]: now,
    [`passengers/${params.passengerId}/referralRewardClaimId`]: claimId,
  })
  return true
}

/**
 * Restores missing first-ride claims after an offline settlement. Claims are
 * keyed by passenger UID, so this remains safe to run whenever Admin opens.
 */
export async function reconcileReferralRewardClaims(): Promise<number> {
  const db = database("admin")
  const ridesSnapshot = await get(ref(db, "rides"))
  const rides = Object.entries(
    (ridesSnapshot.val() ?? {}) as Record<string, Record<string, unknown>>,
  )
  const earliestSettledRide = new Map<string, {
    rideId: string
    passengerName: string
    settledAt: number
  }>()
  for (const [rideId, ride] of rides) {
    if (String(ride.status ?? "") !== "settled") continue
    const passengerId = String(ride.passengerId ?? "")
    if (!passengerId) continue
    const settledAt = Number(
      ride.settledAt ?? ride.updatedAt ?? ride.createdAt ?? 0,
    )
    const current = earliestSettledRide.get(passengerId)
    if (
      !current ||
      settledAt < current.settledAt ||
      (settledAt === current.settledAt && rideId < current.rideId)
    ) {
      earliestSettledRide.set(passengerId, {
        rideId,
        passengerName: String(ride.passengerName ?? "PASADA passenger"),
        settledAt,
      })
    }
  }

  let queued = 0
  for (const [passengerId, ride] of earliestSettledRide) {
    const created = await queueReferralRewardForSettledRide({
      rideId: ride.rideId,
      passengerId,
      passengerName: ride.passengerName,
    }).catch(() => false)
    if (created) queued += 1
  }
  return queued
}

export async function processReferralReward(params: {
  claim: ReferralRewardClaim
  config: CashTokenConfig
  privateKeyWif: string
}) {
  const admin = getScopedFirebase("admin").auth.currentUser
  if (!admin) throw new Error("Log in as an administrator to distribute PRC.")
  const db = database("admin")
  const reserve = await fetchCashTokenWalletSnapshot(
    params.config.issuerAddress,
    params.config.categoryId,
  )
  if (reserve.tokenBalance < params.claim.amount) {
    throw new Error(
      "No PRC coupons are available in the reserve. This entitlement remains pending.",
    )
  }
  if (reserve.bchSats < PRC_TOKEN_DUST_SATS * 2 + 1_000) {
    throw new Error(
      "The PRC issuer needs more BCH for token dust and miner fees. This entitlement remains pending.",
    )
  }
  const now = Date.now()
  const reservation = await runTransaction(
    ref(db, `platform/cashtoken/rewardClaims/${params.claim.id}`),
    (current: ReferralRewardClaim | null) => {
      if (!current || !["pending", "failed"].includes(current.status)) return
      return { ...current, status: "processing", error: null, updatedAt: now }
    },
  )
  if (!reservation.committed) return null
  await update(
    ref(db, `platform/cashtoken/activity/reward_${params.claim.id}`),
    {
      status: "processing",
      error: null,
      updatedAt: now,
    },
  )
  let txid: string
  try {
    txid = await transferReferralCredit({
      issuerAddress: params.config.issuerAddress,
      privateKeyWif: params.privateKeyWif,
      recipientTokenAddress: params.claim.referrerTokenAddress,
      categoryId: params.config.categoryId,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PRC reward transfer failed."
    const failedAt = Date.now()
    await update(ref(db), {
      [`platform/cashtoken/rewardClaims/${params.claim.id}/status`]: "failed",
      [`platform/cashtoken/rewardClaims/${params.claim.id}/error`]: message,
      [`platform/cashtoken/rewardClaims/${params.claim.id}/updatedAt`]:
        failedAt,
      [`platform/cashtoken/activity/reward_${params.claim.id}/status`]:
        "failed",
      [`platform/cashtoken/activity/reward_${params.claim.id}/error`]: message,
      [`platform/cashtoken/activity/reward_${params.claim.id}/updatedAt`]:
        failedAt,
    })
    throw new Error(message)
  }

  const completedAt = Date.now()
  try {
    await update(ref(db), {
      [`platform/cashtoken/rewardClaims/${params.claim.id}/status`]: "sent",
      [`platform/cashtoken/rewardClaims/${params.claim.id}/txid`]: txid,
      [`platform/cashtoken/rewardClaims/${params.claim.id}/error`]: null,
      [`platform/cashtoken/rewardClaims/${params.claim.id}/updatedAt`]:
        completedAt,
      [`platform/cashtoken/activity/reward_${params.claim.id}/status`]:
        "confirmed",
      [`platform/cashtoken/activity/reward_${params.claim.id}/txid`]: txid,
      [`platform/cashtoken/activity/reward_${params.claim.id}/error`]: null,
      [`platform/cashtoken/activity/reward_${params.claim.id}/updatedAt`]:
        completedAt,
      [`passengers/${params.claim.referrerUid}/lastReferralRewardTxid`]: txid,
      [`passengers/${params.claim.referrerUid}/updatedAt`]: completedAt,
      [`adminAudit/${completedAt}_prc_reward_${params.claim.id}`]: {
        action: "prc_referral_reward_sent",
        claimId: params.claim.id,
        txid,
        adminUid: admin.uid,
        createdAt: completedAt,
      },
    })
    return txid
  } catch (error) {
    // The on-chain broadcast already succeeded. Keep the claim in processing
    // rather than retrying and risking a duplicate token reward.
    throw new Error(
      `PRC reward ${txid} was broadcast, but Firebase did not confirm the activity log. Do not resend it automatically.`,
    )
  }
}

/** Sends an administrator-selected amount of real PRC to a passenger. */
export async function grantCouponCredit(params: {
  config: CashTokenConfig
  privateKeyWif: string
  recipientUid: string
  recipientName: string
  recipientTokenAddress: string
  amount: number
}) {
  const admin = getScopedFirebase("admin").auth.currentUser
  if (!admin) throw new Error("Log in as an administrator to distribute PRC.")
  const amount = Math.max(1, Math.trunc(params.amount))
  const reserve = await fetchCashTokenWalletSnapshot(
    params.config.issuerAddress,
    params.config.categoryId,
  )
  if (reserve.tokenBalance < amount) {
    throw new Error(
      "The PRC reserve does not contain enough unassigned coupons.",
    )
  }
  if (reserve.bchSats < PRC_TOKEN_DUST_SATS * 2 + 1_000) {
    throw new Error("The PRC issuer needs BCH for token dust and miner fees.")
  }
  const txid = await transferReferralCredit({
    issuerAddress: params.config.issuerAddress,
    privateKeyWif: params.privateKeyWif,
    recipientTokenAddress: params.recipientTokenAddress,
    categoryId: params.config.categoryId,
    amount,
  })
  const now = Date.now()
  const activity: CashTokenActivity = {
    id: `grant_${txid}`,
    type: "admin_grant",
    status: "confirmed",
    amount,
    txid,
    referrerUid: params.recipientUid,
    referrerName: params.recipientName,
    createdAt: now,
    updatedAt: now,
  }
  await update(ref(database("admin")), {
    [`platform/cashtoken/activity/${activity.id}`]: activity,
    [`passengers/${params.recipientUid}/lastCouponGrantTxid`]: txid,
    [`passengers/${params.recipientUid}/updatedAt`]: now,
    [`adminAudit/${now}_prc_grant_${params.recipientUid}`]: {
      action: "prc_coupon_granted",
      recipientUid: params.recipientUid,
      recipientName: params.recipientName,
      amount,
      txid,
      adminUid: admin.uid,
      createdAt: now,
    },
  })
  return txid
}

export async function recordCouponRedemption(params: {
  rideId: string
  passengerId: string
  passengerName: string
  txid: string
}) {
  const db = database("passenger")
  const id = `redemption_${params.rideId}`
  const now = Date.now()
  const activity: CashTokenActivity = {
    id,
    type: "coupon_redemption",
    status: "confirmed",
    amount: 1,
    txid: params.txid,
    rideId: params.rideId,
    referredPassengerId: params.passengerId,
    referredPassengerName: params.passengerName,
    createdAt: now,
    updatedAt: now,
  }
  await runTransaction(
    ref(db, `platform/cashtoken/activity/${id}`),
    (current: CashTokenActivity | null) => current ?? activity,
  )
}
