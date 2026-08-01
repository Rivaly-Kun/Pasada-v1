import {
  onValue,
  ref,
  runTransaction,
  update,
  type Unsubscribe,
} from "firebase/database"
import { normalizeAndValidateBchAddress } from "./bch-wallet"
import { DEFAULT_FARE_CONFIG } from "./fare"
import { getScopedFirebase, type FirebaseScope } from "./firebase"
import type { FareConfig, LiveRide } from "./types"

export const PLATFORM_ACCOUNT_ID = "pasada-platform"

export type PlatformAccount = {
  id: typeof PLATFORM_ACCOUNT_ID
  role: "admin"
  displayName: string
  bchAddress: string | null
  createdAt: number
  updatedAt: number
  balance: {
    availableSats: number
    bchCommissionSats: number
    settledRideCount: number
    updatedAt: number
  }
}

export type PlatformMetrics = {
  totalRideSats: number
  totalPlatformFeeSats: number
  totalBchFeeSats: number
  settledRides: number
  bchRides: number
}

function database(scope: FirebaseScope = "passenger") {
  return getScopedFirebase(scope).database
}

import { generateBchWallet } from "./bch-wallet"

function defaultAccount(now: number): PlatformAccount {
  const adminWallet = generateBchWallet()
  return {
    id: PLATFORM_ACCOUNT_ID,
    role: "admin",
    displayName: "PASADA Platform Administrator",
    bchAddress: adminWallet.address,
    createdAt: now,
    updatedAt: now,
    balance: {
      availableSats: 0,
      bchCommissionSats: 0,
      settledRideCount: 0,
      updatedAt: now,
    },
  }
}

/** Creates the single, public platform ledger account with a dedicated Chipnet fee address. */
export async function ensurePlatformState(): Promise<void> {
  const now = Date.now()
  await runTransaction(
    ref(database(), "platform"),
    (current: Record<string, unknown> | null) => {
      const existingAccount = (current?.account ??
        null) as PlatformAccount | null
      const account =
        existingAccount && existingAccount.bchAddress
          ? existingAccount
          : defaultAccount(now)
      if (!current) return { account, fareConfig: DEFAULT_FARE_CONFIG }
      return {
        ...current,
        account,
        fareConfig: current.fareConfig ?? DEFAULT_FARE_CONFIG,
      }
    },
  )
}

export function subscribePlatformFareConfig(
  onConfig: (config: FareConfig) => void,
): Unsubscribe {
  return onValue(ref(database(), "platform/fareConfig"), (snapshot) => {
    if (!snapshot.exists()) {
      onConfig(DEFAULT_FARE_CONFIG)
      return
    }
    onConfig({
      ...DEFAULT_FARE_CONFIG,
      ...snapshot.val() as Partial<FareConfig>,
    })
  })
}

export async function publishPlatformFareConfig(
  config: FareConfig,
): Promise<void> {
  const now = Date.now()
  const adminUid = getScopedFirebase("admin").auth.currentUser?.uid
  if (!adminUid)
    throw new Error("Log in as an administrator before publishing fares.")
  await update(ref(database("admin")), {
    "platform/fareConfig": config,
    [`platform/fareConfigHistory/${config.version}_${now}`]: {
      ...config,
      publishedAt: now,
    },
    "platform/account/updatedAt": now,
    [`adminAudit/${now}_fare_${config.version}`]: {
      action: "fare_config_published",
      version: config.version,
      adminUid,
      createdAt: now,
    },
  })
}

export function subscribePlatformAccount(
  onAccount: (account: PlatformAccount | null) => void,
  scope: FirebaseScope = "passenger",
): Unsubscribe {
  return onValue(ref(database(scope), "platform/account"), (snapshot) => {
    onAccount(snapshot.exists() ? snapshot.val() as PlatformAccount : null)
  })
}

export async function setPlatformBchAddress(value: string): Promise<void> {
  const address = value.trim()
  const adminUid = getScopedFirebase("admin").auth.currentUser?.uid
  if (!adminUid)
    throw new Error(
      "Log in as an administrator before changing the platform wallet.",
    )
  if (!address) {
    await update(ref(database("admin"), "platform/account"), {
      bchAddress: null,
      updatedAt: Date.now(),
    })
    return
  }
  const validated = normalizeAndValidateBchAddress(address)
  if (!validated.valid) throw new Error(validated.error)
  if (!validated.address.startsWith("bchtest:")) {
    throw new Error("PASADA admin accepts Chipnet addresses only (bchtest:).")
  }
  const now = Date.now()
  await update(ref(database("admin"), "platform/account"), {
    bchAddress: validated.address,
    updatedAt: now,
  })
  await update(ref(database("admin"), `adminAudit/${now}_platform_wallet`), {
    action: "platform_wallet_updated",
    address: validated.address,
    adminUid,
    createdAt: now,
  })
}

export function subscribePlatformMetrics(
  onMetrics: (metrics: PlatformMetrics) => void,
  scope: FirebaseScope = "passenger",
): Unsubscribe {
  return onValue(ref(database(scope), "rides"), (snapshot) => {
    const rides = snapshot.exists()
      ? Object.values(snapshot.val() as Record<string, LiveRide>)
      : []
    const metrics = rides.reduce<PlatformMetrics>(
      (total, ride) => {
        if (ride.status !== "settled") return total
        const fareSats = Number(ride.fareSats ?? 0)
        const feeSats = Number(ride.platformFeeSats ?? 0)
        total.totalRideSats += fareSats
        total.totalPlatformFeeSats += feeSats
        total.settledRides += 1
        total.bchRides += 1
        total.totalBchFeeSats += feeSats
        return total
      },
      {
        totalRideSats: 0,
        totalPlatformFeeSats: 0,
        totalBchFeeSats: 0,
        settledRides: 0,
        bchRides: 0,
      },
    )
    onMetrics(metrics)
  })
}
