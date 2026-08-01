import {
  get,
  increment,
  onDisconnect,
  onValue,
  push,
  ref,
  runTransaction,
  update,
  type Database,
  type Unsubscribe,
} from "firebase/database"
import { getScopedFirebase, type AppRole } from "./firebase"
import { toSatoshis } from "./fare"
import {
  EscrowBroadcastPendingError,
  ESCROW_FUNDING_FEE_RESERVE_SATS,
  fundEscrow,
  isEscrowFunded,
  prepareEscrowDescriptor,
  refundEscrow,
  settleEscrow,
} from "./bch-escrow"
import { validatePrivateKeyForBchAddress } from "./bch-wallet"
import { DEMO_DRIVER_START, distanceKm, interpolatePoint } from "./geo"
import { ensurePlatformState, PLATFORM_ACCOUNT_ID } from "./platform-service"
import type {
  FareConfig,
  GeoPoint,
  LiveDriver,
  LiveRide,
  PasadaAccount,
} from "./types"

type DriverSeed = {
  plate: string
  body: string
  rating: number
  trips: number
}

const DRIVER_HEARTBEAT_TIMEOUT_MS = 30_000
const DRIVER_REOFFER_COOLDOWN_MS = 30_000

type RideInput = {
  passenger: PasadaAccount
  from: string
  to: string
  pickup: GeoPoint
  destination: GeoPoint
  distanceKm: number
  durationMin: number
  passengers: number
  discountedSeats: number
  specialTrip: boolean
  nightTrip: boolean
  total: number
  transportationFare: number
  platformFee: number
  platformTax: number
  config: FareConfig
  demoMode?: boolean
  demoDriver?: DriverSeed
  demoDriverAccount?: PasadaAccount
}

function roleDatabase(role: AppRole): Database {
  return getScopedFirebase(role).database
}

async function linkedWalletWif(
  db: Database,
  role: "passenger" | "driver",
  uid: string,
  address: string,
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("A BCH escrow can only be signed in its wallet browser.")
  }

  const normalizedAddress = address.trim().toLowerCase()
  const localWif = localStorage.getItem(`pasada_wif_${normalizedAddress}`)
  if (!localWif) {
    const wallet = (
      await get(ref(db, `roleWallets/${role}/${uid}`))
    ).val() as { mode?: string; source?: string } | null
    const walletMode = wallet?.mode ?? wallet?.source
    if (walletMode === "paytaca_walletconnect") {
      throw new Error(
        `This ${role} uses Paytaca through WalletConnect. BCH escrow requires an approved Paytaca transaction signature; PASADA never accepts its recovery phrase, WIF, or private key.`,
      )
    }
    if (walletMode === "address_only") {
      throw new Error(
        `This ${role} linked an address for ownership verification only. Connect a signing wallet before using BCH escrow.`,
      )
    }
    throw new Error(
      `Open the ${role} wallet in the browser where its in-app BCH wallet was created. Private keys are never read from Firebase.`,
    )
  }

  const validated = validatePrivateKeyForBchAddress(localWif, address)
  if (!validated.valid) {
    throw new Error(
      `The saved ${role} signing key does not control the displayed BCH address. Link the matching key in this browser.`,
    )
  }
  return validated.privateKeyWif
}

async function refreshChainWallets(
  wallets: Array<{ role: "passenger" | "driver"; uid: string; address: string }>,
) {
  const { refreshPasadaWalletBalance } = await import("./auth")
  await Promise.allSettled(
    wallets.map((wallet) =>
      refreshPasadaWalletBalance(wallet.role, wallet.uid, wallet.address),
    ),
  )
}

export function subscribeAccountBalance(
  role: AppRole,
  uid: string,
  onBalance: (satoshis: number) => void,
): Unsubscribe {
  return onValue(
    ref(
      roleDatabase(role),
      `roleAccounts/${role}/${uid}/balance/availableSats`,
    ),
    (snapshot) => {
      if (snapshot.exists() && snapshot.val() !== null) {
        onBalance(Number(snapshot.val()))
      }
    },
  )
}

export async function setDriverPresence(
  account: PasadaAccount,
  online: boolean,
  location: GeoPoint,
  seed: DriverSeed,
): Promise<void> {
  const db = roleDatabase("driver")
  const driverRef = ref(db, `drivers/${account.uid}`)
  const snapshot = await get(driverRef)
  const current = snapshot.val() as LiveDriver | null
  const now = Date.now()
  const driver: LiveDriver = {
    id: account.uid,
    name: account.displayName,
    plate: seed.plate,
    body: seed.body,
    rating: seed.rating,
    trips: current?.trips ?? seed.trips,
    bchAddress: account.bchAddress,
    bchPublicKey: account.bchPublicKey,
    online,
    available: online && !current?.assignedRideId,
    assignedRideId: current?.assignedRideId ?? null,
    location,
    updatedAt: now,
  }

  await update(driverRef, driver)
  if (online) {
    await onDisconnect(driverRef).update({
      online: false,
      available: false,
      updatedAt: now,
    })
    await dispatchOldestWaitingRide(db)
  } else {
    await onDisconnect(driverRef).cancel()
  }
}

export function subscribeDriver(
  driverId: string,
  onDriver: (driver: LiveDriver | null) => void,
): Unsubscribe {
  return onValue(
    ref(roleDatabase("driver"), `drivers/${driverId}`),
    (snapshot) => {
      onDriver(snapshot.exists() ? snapshot.val() as LiveDriver : null)
    },
  )
}

export async function updateDriverLocation(
  driverId: string,
  location: GeoPoint,
): Promise<void> {
  const db = roleDatabase("driver")
  const driverSnapshot = await get(ref(db, `drivers/${driverId}`))
  const driver = driverSnapshot.val() as LiveDriver | null
  if (!driver?.online) return
  const now = Date.now()
  const writes: Record<string, unknown> = {
    [`drivers/${driverId}/location`]: location,
    [`drivers/${driverId}/updatedAt`]: now,
  }
  if (driver.assignedRideId) {
    const rideSnapshot = await get(ref(db, `rides/${driver.assignedRideId}`))
    const ride = rideSnapshot.exists()
      ? normalizeRide(rideSnapshot.val() as LiveRide)
      : null
    if (
      ride &&
      ride.driverId === driverId &&
      !["settled", "cancelled"].includes(ride.status)
    ) {
      writes[`rides/${ride.id}/driver/location`] = location
      writes[`rides/${ride.id}/updatedAt`] = now
      if (
        ["searching", "accepted", "arriving", "awaiting_pin"].includes(
          ride.status,
        )
      ) {
        writes[`rides/${ride.id}/distanceToPickupKm`] =
          Math.round(distanceKm(location, ride.pickup) * 10) / 10
      }
      if (ride.status === "in_transit") {
        const totalDistance = Math.max(
          0.05,
          distanceKm(ride.pickup, ride.destination),
        )
        const remainingDistance = distanceKm(location, ride.destination)
        writes[`rides/${ride.id}/progress`] = Math.min(
          1,
          Math.max(ride.progress, 1 - remainingDistance / totalDistance),
        )
      }
    }
  }
  await update(ref(db), writes)
}

export async function heartbeatDriver(driverId: string): Promise<void> {
  const db = roleDatabase("driver")
  await runTransaction(
    ref(db, `drivers/${driverId}`),
    (driver: LiveDriver | null) => {
      if (!driver?.online) return
      return { ...driver, updatedAt: Date.now() }
    },
  )
}

export async function createRide(input: RideInput): Promise<string> {
  const db = roleDatabase("passenger")
  await ensurePlatformState()
  if (input.demoMode) {
    if (!input.demoDriver || !input.demoDriverAccount) {
      throw new Error(
        "Log in to the PASADA Driver app before starting the demo.",
      )
    }
    await prepareDemoDriver(db, input.demoDriverAccount, input.demoDriver)
  }

  const now = Date.now()
  const rideRef = push(ref(db, "rides"))
  if (!rideRef.key) throw new Error("Could not allocate a ride id.")
  const rideId = rideRef.key
  const platformSnapshot = await get(ref(db, "platform/account"))
  const platformAccount = platformSnapshot.val() as {
    bchAddress?: string | null
  } | null
  const fareSats = toSatoshis(input.total, input.config)
  const transportationFareSats = toSatoshis(
    input.transportationFare,
    input.config,
  )
  // Derive the fee from the two booked outputs so their satoshi values always
  // sum exactly to the charged total, even when PHP-to-satoshi rounding differs
  // by one satoshi between independently converted components.
  const platformFeeSats = Math.max(0, fareSats - transportationFareSats)
  const platformTaxSats = Math.min(
    platformFeeSats,
    toSatoshis(input.platformTax, input.config),
  )
  const driverPayoutSats = transportationFareSats
  const requiredSats = fareSats + ESCROW_FUNDING_FEE_RESERVE_SATS * 2
  let passengerPublicKey = input.passenger.bchPublicKey

  if (!input.demoMode) {
    if (!passengerPublicKey) {
      throw new Error(
        "This BCH address was linked before ownership verification. Reconnect or re-link the wallet to use BCH escrow.",
      )
    }
    let liveBalanceSats = Number(input.passenger.availableSats ?? 0)
    try {
      const { refreshPasadaWalletBalance } = await import("./auth")
      liveBalanceSats = await refreshPasadaWalletBalance(
        "passenger",
        input.passenger.uid,
        input.passenger.bchAddress,
      )
    } catch {
      // The booking remains safe: the real funding transaction will independently
      // check UTXOs. Use the most recently confirmed address balance for the quote.
    }
    if (liveBalanceSats < requiredSats) {
      throw new Error(
        "Your BCH wallet does not have enough for this fare and its network fees.",
      )
    }
  }

  const ride: LiveRide = {
    id: rideId,
    passengerId: input.passenger.uid,
    passengerName: input.passenger.displayName,
    passengerBchAddress: input.passenger.bchAddress,
    passengerPublicKey,
    driverId: null,
    driverName: null,
    driver: null,
    from: input.from,
    to: input.to,
    pickup: input.pickup,
    destination: input.destination,
    distanceKm: input.distanceKm,
    durationMin: input.durationMin,
    distanceToPickupKm: null,
    passengers: input.passengers,
    discountedSeats: input.discountedSeats,
    specialTrip: input.specialTrip,
    nightTrip: input.nightTrip,
    method: "bch",
    paymentStatus: "awaiting_driver",
    fareSats,
    transportationFareSats,
    platformFeeSats,
    platformTaxSats,
    driverPayoutSats,
    platformAccountId: PLATFORM_ACCOUNT_ID,
    platformBchAddress: platformAccount?.bchAddress ?? null,
    total: input.total,
    platformFee: input.platformFee,
    config: input.config,
    pin: String(
      crypto.getRandomValues(new Uint16Array(1))[0] % 10_000,
    ).padStart(4, "0"),
    status: "searching",
    progress: 0,
    rejectedDriverIds: {},
    demoMode: input.demoMode ?? false,
    demoDriverApproachProgress: 0,
    createdAt: now,
    updatedAt: now,
  }

  const writes: Record<string, unknown> = {
    [`rides/${rideId}`]: ride,
    [`passengerRides/${input.passenger.uid}/${rideId}`]: {
      rideId,
      status: ride.status,
      createdAt: now,
    },
  }
  await update(ref(db), writes)
  const dispatched = await dispatchRide(
    db,
    rideId,
    input.demoMode ? input.demoDriverAccount?.uid : undefined,
  )
  if (input.demoMode && dispatched && input.demoDriverAccount) {
    void animateDemoRide(input.demoDriverAccount.uid, rideId)
  }
  return rideId
}

async function prepareDemoDriver(
  db: Database,
  account: PasadaAccount,
  seed: DriverSeed,
) {
  const driverRef = ref(db, `drivers/${account.uid}`)
  const current = (await get(driverRef)).val() as LiveDriver | null
  if (current?.assignedRideId) {
    const assigned = (
      await get(ref(db, `rides/${current.assignedRideId}`))
    ).val() as LiveRide | null
    if (assigned && !["settled", "cancelled"].includes(assigned.status)) {
      throw new Error(
        "Finish or cancel the active ride before starting the Ormoc demo.",
      )
    }
  }
  const now = Date.now()
  await update(driverRef, {
    id: account.uid,
    name: account.displayName,
    plate: seed.plate,
    body: seed.body,
    rating: seed.rating,
    trips: seed.trips,
    bchAddress: account.bchAddress,
    bchPublicKey: account.bchPublicKey,
    online: true,
    available: true,
    assignedRideId: null,
    location: DEMO_DRIVER_START,
    updatedAt: now,
  } satisfies LiveDriver)
  await onDisconnect(driverRef).update({
    online: false,
    available: false,
    updatedAt: now,
  })
}

export function subscribeRide(
  role: AppRole,
  rideId: string,
  onRide: (ride: LiveRide | null) => void,
): Unsubscribe {
  return onValue(ref(roleDatabase(role), `rides/${rideId}`), (snapshot) => {
    onRide(snapshot.exists() ? normalizeRide(snapshot.val() as LiveRide) : null)
  })
}

export function subscribeRideHistory(
  role: AppRole,
  uid: string,
  onRides: (rides: LiveRide[]) => void,
): Unsubscribe {
  return onValue(ref(roleDatabase(role), "rides"), (snapshot) => {
    if (!snapshot.exists()) {
      onRides([])
      return
    }
    const rides = Object.values(snapshot.val() as Record<string, LiveRide>)
      .map(normalizeRide)
      .filter((ride) =>
        role === "passenger" ? ride.passengerId === uid : ride.driverId === uid,
      )
      .sort((left, right) => right.createdAt - left.createdAt)
    onRides(rides)
  })
}

export async function acceptRide(
  driverId: string,
  rideId: string,
): Promise<boolean> {
  const db = roleDatabase("driver")
  const now = Date.now()
  const driverClaim = await runTransaction(
    ref(db, `drivers/${driverId}`),
    (driver: LiveDriver | null) => {
      if (
        !driver?.online ||
        (driver.assignedRideId && driver.assignedRideId !== rideId)
      )
        return
      return {
        ...driver,
        available: false,
        assignedRideId: rideId,
        updatedAt: now,
      }
    },
  )
  if (!driverClaim.committed) {
    const currentDriver = driverClaim.snapshot.val() as LiveDriver | null
    if (!currentDriver?.online) {
      throw new Error("Your driver radar is offline. Go online and try again.")
    }
    throw new Error(
      "This driver is already assigned to another ride. Finish or cancel it first.",
    )
  }
  const claimedDriver = driverClaim.snapshot.val() as LiveDriver

  const reservation = await runTransaction(
    ref(db, `rides/${rideId}`),
    (ride: LiveRide | null) => {
      const retryingFailedFunding =
        ride?.status === "funding" && ride.paymentStatus === "failed"
      if (
        !ride ||
        (ride.driverId && ride.driverId !== driverId) ||
        (ride.status !== "searching" && !retryingFailedFunding)
      )
        return
      const { fundingError: _fundingError, ...retryingRide } = ride
      return {
        ...retryingRide,
        driverId,
        driverName: claimedDriver.name,
        driver: claimedDriver,
        distanceToPickupKm:
          Math.round(distanceKm(claimedDriver.location, ride.pickup) * 10) / 10,
        status: "funding",
        paymentStatus: "funding",
        updatedAt: now,
      }
    },
  )
  if (!reservation.committed) {
    const latestSnapshot = await get(ref(db, `rides/${rideId}`))
    const latestRide = latestSnapshot.exists()
      ? normalizeRide(latestSnapshot.val() as LiveRide)
      : null
    if (latestRide?.driverId !== driverId) {
      await runTransaction(
        ref(db, `drivers/${driverId}`),
        (driver: LiveDriver | null) => {
          if (!driver || driver.assignedRideId !== rideId) return
          return {
            ...driver,
            available: true,
            assignedRideId: null,
            updatedAt: Date.now(),
          }
        },
      )
    }
    if (!latestRide) throw new Error("This booking no longer exists.")
    if (latestRide.driverId && latestRide.driverId !== driverId) {
      throw new Error("This booking was assigned to another driver.")
    }
    if (latestRide.status === "funding") {
      throw new Error("BCH escrow preparation is already in progress.")
    }
    throw new Error("This booking is no longer open for acceptance.")
  }
  const ride = normalizeRide(reservation.snapshot.val() as LiveRide)

  if (ride.demoMode) {
    await update(ref(db), {
      [`rides/${rideId}/status`]: "accepted",
      [`rides/${rideId}/paymentStatus`]: "funded",
      [`rides/${rideId}/acceptedAt`]: now,
      [`rides/${rideId}/updatedAt`]: now,
      [`driverRequests/${driverId}/${rideId}/status`]: "accepted",
      [`passengerRides/${ride.passengerId}/${rideId}/status`]: "accepted",
    })
    return true
  }

  try {
    if (!ride.passengerPublicKey) {
      throw new Error(
        "This ride was created before BCH wallet linking was updated. Have the passenger cancel it and create a new ride.",
      )
    }
    const driverAddress = ride.driver?.bchAddress ?? ""
    const platformAddress = String(
      (await get(ref(db, "platform/account/bchAddress"))).val() ?? "",
    )
    if (!driverAddress || !platformAddress) {
      throw new Error(
        "A driver and PASADA platform BCH address are required before funding escrow.",
      )
    }
    const driverPublicKey = ride.driver?.bchPublicKey ?? ""
    if (!driverPublicKey) {
      throw new Error(
        "The driver's BCH address has not completed ownership verification.",
      )
    }
    const escrow = prepareEscrowDescriptor({
      passengerAddress: ride.passengerBchAddress,
      passengerPublicKey: ride.passengerPublicKey,
      driverAddress,
      driverPublicKey,
      platformAddress,
      driverPayoutSats: ride.driverPayoutSats,
      platformFeeSats: ride.platformFeeSats,
    })

    await update(ref(db, `rides/${rideId}`), {
      escrow,
      platformBchAddress: platformAddress,
      updatedAt: Date.now(),
    })
    return true
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Escrow preparation failed."
    await runTransaction(
      ref(db, `rides/${rideId}`),
      (current: LiveRide | null) => {
        if (
          !current ||
          current.driverId !== driverId ||
          current.status !== "funding"
        )
          return
        return {
          ...current,
          status: "funding",
          paymentStatus: "failed",
          fundingError: message,
          ...(current.escrow
            ? { escrow: { ...current.escrow, error: message } }
            : {}),
          updatedAt: Date.now(),
        }
      },
    )
    throw new Error(message)
  }
}

/**
 * Runs only in the passenger application. The funding key stays in that
 * browser, so a separately hosted driver app can never retrieve it.
 */
export async function fundRideEscrow(
  passengerId: string,
  rideId: string,
): Promise<boolean> {
  const db = roleDatabase("passenger")
  const reservation = await runTransaction(
    ref(db, `rides/${rideId}`),
    (current: LiveRide | null) => {
      if (
        !current ||
        current.passengerId !== passengerId ||
        current.status !== "funding" ||
        current.paymentStatus !== "funding" ||
        !current.escrow ||
        current.escrow.fundingTxid
      )
        return
      const { fundingError: _fundingError, ...fundingRide } = current
      return {
        ...fundingRide,
        paymentStatus: "funding_broadcasting",
        updatedAt: Date.now(),
      }
    },
  )
  if (!reservation.committed) return false
  const ride = normalizeRide(reservation.snapshot.val() as LiveRide)
  const escrow = ride.escrow
  if (!escrow) return false

  let fundingTxid: string | undefined
  try {
    const passengerWif = await linkedWalletWif(
      db,
      "passenger",
      passengerId,
      escrow.passengerAddress,
    )
    fundingTxid = await fundEscrow(escrow, passengerWif)
    const fundedAt = Date.now()
    const funded = await runTransaction(
      ref(db, `rides/${rideId}`),
      (current: LiveRide | null) => {
        if (
          !current ||
          current.passengerId !== passengerId ||
          current.status !== "funding" ||
          current.paymentStatus !== "funding_broadcasting"
        )
          return
        return {
          ...current,
          status: "accepted",
          paymentStatus: "funded",
          acceptedAt: fundedAt,
          escrow: { ...escrow, fundingTxid },
          updatedAt: fundedAt,
        }
      },
    )
    if (!funded.committed) {
      // A broadcast tx is authoritative, even if this client lost the status
      // race immediately afterwards.
      await update(ref(db, `rides/${rideId}`), {
        status: "accepted",
        paymentStatus: "funded",
        acceptedAt: fundedAt,
        escrow: { ...escrow, fundingTxid },
        updatedAt: fundedAt,
      })
    }
    const statusWrites: Record<string, unknown> = {
      [`passengerRides/${passengerId}/${rideId}/status`]: "accepted",
    }
    if (ride.driverId) {
      statusWrites[`driverRequests/${ride.driverId}/${rideId}/status`] =
        "accepted"
    }
    await update(ref(db), statusWrites)
    void refreshChainWallets([
      {
        role: "passenger",
        uid: passengerId,
        address: escrow.passengerAddress,
      },
    ])
    return true
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Escrow funding failed."
    if (fundingTxid) {
      await update(ref(db, `rides/${rideId}`), {
        status: "accepted",
        paymentStatus: "funded",
        [`escrow/fundingTxid`]: fundingTxid,
        [`escrow/error`]: message,
        updatedAt: Date.now(),
      })
      return true
    }
    if (error instanceof EscrowBroadcastPendingError) {
      await update(ref(db, `rides/${rideId}/escrow`), { error: message })
      throw error
    }
    await runTransaction(
      ref(db, `rides/${rideId}`),
      (current: LiveRide | null) => {
        if (
          !current ||
          current.passengerId !== passengerId ||
          current.status !== "funding" ||
          current.paymentStatus !== "funding_broadcasting"
        )
          return
        return {
          ...current,
          paymentStatus: "failed",
          fundingError: message,
          ...(current.escrow
            ? { escrow: { ...current.escrow, error: message } }
            : {}),
          updatedAt: Date.now(),
        }
      },
    )
    throw new Error(message)
  }
}

/**
 * Recovers a ride that was left in `funding` by an interrupted browser or
 * network request. It first checks the actual contract address, avoiding a
 * second funding transaction if the first one already reached the chain.
 */
export async function retryEscrowFunding(
  driverId: string,
  rideId: string,
): Promise<boolean> {
  const db = roleDatabase("driver")
  const snapshot = await get(ref(db, `rides/${rideId}`))
  if (!snapshot.exists()) return false
  const ride = normalizeRide(snapshot.val() as LiveRide)
  if (
    ride.driverId !== driverId ||
    ride.status !== "funding" ||
    ride.paymentStatus !== "failed"
  )
    return false

  if (ride.escrow) {
    const funded = await isEscrowFunded(ride.escrow)
    if (funded) {
      const now = Date.now()
      await update(ref(db), {
        [`rides/${rideId}/status`]: "accepted",
        [`rides/${rideId}/paymentStatus`]: "funded",
        [`rides/${rideId}/acceptedAt`]: now,
        [`rides/${rideId}/escrow/error`]: null,
        [`rides/${rideId}/updatedAt`]: now,
        [`driverRequests/${driverId}/${rideId}/status`]: "accepted",
        [`passengerRides/${ride.passengerId}/${rideId}/status`]: "accepted",
      })
      return true
    }
  }

  if (!ride.escrow) return acceptRide(driverId, rideId)

  const restarted = await runTransaction(
    ref(db, `rides/${rideId}`),
    (current: LiveRide | null) => {
      if (
        !current ||
        current.driverId !== driverId ||
        current.status !== "funding" ||
        current.paymentStatus !== "failed" ||
        !current.escrow
      )
        return
      const { fundingError: _fundingError, ...retryingRide } = current
      return {
        ...retryingRide,
        paymentStatus: "funding",
        escrow: { ...current.escrow, error: null },
        updatedAt: Date.now(),
      }
    },
  )
  return restarted.committed
}

export async function rejectRide(
  driverId: string,
  rideId: string,
): Promise<void> {
  const db = roleDatabase("driver")
  const now = Date.now()
  const result = await runTransaction(
    ref(db, `rides/${rideId}`),
    (ride: LiveRide | null) => {
      if (!ride || ride.driverId !== driverId || ride.status !== "searching")
        return
      return {
        ...ride,
        driverId: null,
        driverName: null,
        driver: null,
        distanceToPickupKm: null,
        rejectedDriverIds: {
          ...(ride.rejectedDriverIds ?? {}),
          [driverId]: now,
        },
        updatedAt: now,
      }
    },
  )
  await update(ref(db), {
    [`drivers/${driverId}/available`]: true,
    [`drivers/${driverId}/assignedRideId`]: null,
    [`drivers/${driverId}/updatedAt`]: now,
    [`driverRequests/${driverId}/${rideId}/status`]: "rejected",
  })
  if (result.committed) await dispatchRide(db, rideId)
}

/**
 * Cancels an assigned ride before the passenger has broadcast the funding
 * transaction. It synchronizes both role indexes and releases the driver.
 */
export async function cancelFundingRideByDriver(
  driverId: string,
  rideId: string,
): Promise<boolean> {
  const db = roleDatabase("driver")
  const cancelledAt = Date.now()
  const cancelled = await runTransaction(
    ref(db, `rides/${rideId}`),
    (current: LiveRide | null) => {
      const cancellingBeforeFunding =
        current?.status === "funding" &&
        ["funding", "failed"].includes(current.paymentStatus)
      const cancellingInvalidCompletion =
        current?.status === "completing" && !current.escrow
      if (
        !current ||
        current.driverId !== driverId ||
        (!cancellingBeforeFunding && !cancellingInvalidCompletion) ||
        current.escrow?.fundingTxid
      )
        return
      return {
        ...current,
        status: "cancelled",
        paymentStatus: "refunded",
        fundingError: "Cancelled by driver before BCH escrow funding.",
        cancelledAt,
        updatedAt: cancelledAt,
      }
    },
  )
  if (!cancelled.committed) return false

  const ride = normalizeRide(cancelled.snapshot.val() as LiveRide)
  await update(ref(db), {
    [`drivers/${driverId}/available`]: true,
    [`drivers/${driverId}/assignedRideId`]: null,
    [`drivers/${driverId}/updatedAt`]: cancelledAt,
    [`driverRequests/${driverId}/${rideId}/status`]: "cancelled",
    [`passengerRides/${ride.passengerId}/${rideId}/status`]: "cancelled",
  })
  return true
}

export async function setRideStatus(
  driverId: string,
  rideId: string,
  from: LiveRide["status"],
  to: LiveRide["status"],
): Promise<boolean> {
  const db = roleDatabase("driver")
  const result = await runTransaction(
    ref(db, `rides/${rideId}`),
    (ride: LiveRide | null) => {
      if (!ride || ride.driverId !== driverId || ride.status !== from) return
      if (
        !ride.demoMode &&
        ["accepted", "arriving", "awaiting_pin", "in_transit"].includes(to) &&
        (ride.paymentStatus !== "funded" || !ride.escrow?.fundingTxid)
      )
        return
      return { ...ride, status: to, updatedAt: Date.now() }
    },
  )
  return result.committed
}

export async function verifyRidePin(
  driverId: string,
  rideId: string,
  pin: string,
): Promise<boolean> {
  const db = roleDatabase("driver")
  const result = await runTransaction(
    ref(db, `rides/${rideId}`),
    (ride: LiveRide | null) => {
      if (
        !ride ||
        ride.driverId !== driverId ||
        ride.status !== "awaiting_pin" ||
        ride.pin !== pin ||
        (!ride.demoMode &&
          (ride.paymentStatus !== "funded" || !ride.escrow?.fundingTxid))
      )
        return
      return {
        ...ride,
        status: "in_transit",
        progress: 0,
        updatedAt: Date.now(),
      }
    },
  )
  return result.committed
}

export async function updateRideProgress(
  driverId: string,
  rideId: string,
  progress: number,
): Promise<void> {
  const db = roleDatabase("driver")
  const rideSnapshot = await get(ref(db, `rides/${rideId}`))
  const ride = rideSnapshot.val() as LiveRide | null
  if (!ride || ride.driverId !== driverId || ride.status !== "in_transit")
    return
  await update(ref(db, `rides/${rideId}`), {
    progress: Math.min(1, Math.max(0, progress)),
    updatedAt: Date.now(),
  })
}

export async function completeRide(
  driverId: string,
  rideId: string,
): Promise<boolean> {
  const db = roleDatabase("driver")
  const now = Date.now()
  const reservation = await runTransaction(
    ref(db, `rides/${rideId}`),
    (ride: LiveRide | null) => {
      if (!ride || ride.driverId !== driverId) return
      if (!ride.demoMode && !ride.escrow?.fundingTxid) return
      const retryingSettlement =
        ride.status === "completing" && ride.paymentStatus === "settling"
      const recoveringLegacySettlement =
        ride.status === "settled" &&
        !ride.demoMode &&
        Boolean(ride.escrow?.fundingTxid) &&
        !ride.escrow?.settlementTxid &&
        !ride.onChainTxid
      if (
        !["accepted", "arriving", "awaiting_pin", "in_transit"].includes(
          ride.status,
        ) &&
        !retryingSettlement &&
        !recoveringLegacySettlement
      )
        return
      return {
        ...ride,
        status: "completing",
        paymentStatus: "settling",
        ...(ride.escrow ? { escrow: { ...ride.escrow, error: null } } : {}),
        updatedAt: now,
      }
    },
  )
  if (!reservation.committed) return false
  const ride = normalizeRide(reservation.snapshot.val() as LiveRide)

  let settlementTxid = ride.escrow?.settlementTxid
  try {
    if (!ride.demoMode) {
      if (!ride.escrow) {
        throw new Error("This ride has no funded BCH escrow contract.")
      }
      if (!settlementTxid) {
        const driverWif = await linkedWalletWif(
          db,
          "driver",
          driverId,
          ride.escrow.driverAddress,
        )
        settlementTxid = await settleEscrow(ride.escrow, driverWif)
        await update(ref(db, `rides/${rideId}/escrow`), {
          settlementTxid,
          error: null,
        })
      }
    }

    const settledAt = Date.now()
    const settled = await runTransaction(
      ref(db, `rides/${rideId}`),
      (current: LiveRide | null) => {
        if (!current) return
        return {
          ...current,
          status: "settled",
          paymentStatus: "settled",
          progress: 1,
          settledAt,
          updatedAt: settledAt,
          ...(settlementTxid
            ? { onChainTxid: settlementTxid, onChainBroadcast: true }
            : {}),
        }
      },
    )
    if (!settled.committed) {
      await update(ref(db, `rides/${rideId}`), {
        status: "settled",
        paymentStatus: "settled",
        progress: 1,
        settledAt,
        updatedAt: settledAt,
        ...(settlementTxid
          ? { onChainTxid: settlementTxid, onChainBroadcast: true }
          : {}),
      })
    }

    const writes: Record<string, unknown> = {
      [`drivers/${driverId}/available`]: true,
      [`drivers/${driverId}/assignedRideId`]: null,
      [`drivers/${driverId}/trips`]: increment(1),
      [`drivers/${driverId}/updatedAt`]: settledAt,
      [`users/${driverId}/roleProfiles/driver/trips`]: increment(1),
      [`users/${driverId}/roleProfiles/driver/updatedAt`]: settledAt,
      [`driverRequests/${driverId}/${rideId}/status`]: "settled",
      [`passengerRides/${ride.passengerId}/${rideId}/status`]: "settled",
      [`roleAccounts/driver/${driverId}/balance/lifetimeRideEarningsSats`]:
        increment(ride.driverPayoutSats),
      [`platform/account/balance/bchCommissionSats`]: increment(
        ride.platformFeeSats,
      ),
      [`platform/account/balance/settledRideCount`]: increment(1),
    }
    if (settlementTxid) {
      writes[`rides/${rideId}/onChainTxid`] = settlementTxid
      writes[`rides/${rideId}/onChainBroadcast`] = true
      writes[
        `roleLedgers/driver/${driverId}/${settledAt}_ride_payout_${rideId.slice(-8)}`
      ] = {
        type: "on_chain_escrow_payout",
        amountSats: ride.driverPayoutSats,
        txid: settlementTxid,
        referenceType: "pasada_ride",
        referenceId: rideId,
        createdAt: settledAt,
      }
      writes[`platform/ledger/${settledAt}_bch_fee_${rideId.slice(-8)}`] = {
        type: "on_chain_escrow_fee",
        amountSats: ride.platformFeeSats,
        txid: settlementTxid,
        platformTaxSats: ride.platformTaxSats,
        referenceId: rideId,
        createdAt: settledAt,
      }
    }
    await update(ref(db), writes)
    if (!ride.demoMode) {
      await refreshChainWallets([
        {
          role: "passenger",
          uid: ride.passengerId,
          address: ride.passengerBchAddress,
        },
        {
          role: "driver",
          uid: driverId,
          address: ride.driver?.bchAddress ?? "",
        },
      ])
    }
    return true
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "BCH escrow settlement failed."
    await runTransaction(
      ref(db, `rides/${rideId}`),
      (current: LiveRide | null) => {
        if (
          !current ||
          current.driverId !== driverId ||
          current.status !== "completing"
        )
          return
        return {
          ...current,
          paymentStatus: "settling",
          ...(current.escrow
            ? { escrow: { ...current.escrow, error: message } }
            : {}),
          updatedAt: Date.now(),
        }
      },
    )
    throw new Error(message)
  }
}

export async function submitDriverRating(
  rideId: string,
  driverId: string,
  rating: number,
  comment: string,
  tags: string[],
): Promise<void> {
  const db = roleDatabase("passenger")
  const now = Date.now()
  await update(ref(db), {
    [`rides/${rideId}/rating`]: rating,
    [`rides/${rideId}/reviewComment`]: comment.trim(),
    [`rides/${rideId}/reviewTags`]: tags,
    [`rides/${rideId}/reviewedAt`]: now,
    [`driverReviews/${driverId}/${rideId}`]: {
      rideId,
      rating,
      comment: comment.trim(),
      tags,
      createdAt: now,
    },
  })
}

export async function cancelRide(
  passengerId: string,
  rideId: string,
): Promise<boolean> {
  const db = roleDatabase("passenger")
  const now = Date.now()
  const reservation = await runTransaction(
    ref(db, `rides/${rideId}`),
    (ride: LiveRide | null) => {
      if (
        !ride ||
        ride.passengerId !== passengerId ||
        ["settled", "cancelled", "completing"].includes(ride.status)
      ) {
        return
      }
      if (!ride.escrow || ride.demoMode) {
        return {
          ...ride,
          status: "cancelled",
          paymentStatus: "refunded",
          cancelledAt: now,
          updatedAt: now,
        }
      }
      return {
        ...ride,
        status: "completing",
        paymentStatus: "settling",
        updatedAt: now,
      }
    },
  )
  if (!reservation.committed) return false
  const reservedRide = normalizeRide(reservation.snapshot.val() as LiveRide)
  let ride = reservedRide
  let refundTxid: string | undefined

  try {
    if (reservedRide.escrow && !reservedRide.demoMode) {
      const passengerWif = await linkedWalletWif(
        db,
        "passenger",
        passengerId,
        reservedRide.escrow.passengerAddress,
      )
      refundTxid = await refundEscrow(reservedRide.escrow, passengerWif)
      const refundedAt = Date.now()
      const refunded = await runTransaction(
        ref(db, `rides/${rideId}`),
        (current: LiveRide | null) => {
          if (
            !current ||
            current.passengerId !== passengerId ||
            current.status !== "completing"
          )
            return
          return {
            ...current,
            status: "cancelled",
            paymentStatus: "refunded",
            cancelledAt: refundedAt,
            escrow: { ...reservedRide.escrow!, refundTxid },
            updatedAt: refundedAt,
          }
        },
      )
      if (!refunded.committed) {
        await update(ref(db, `rides/${rideId}`), {
          status: "cancelled",
          paymentStatus: "refunded",
          cancelledAt: refundedAt,
          escrow: { ...reservedRide.escrow, refundTxid },
          updatedAt: refundedAt,
        })
        ride = {
          ...reservedRide,
          status: "cancelled",
          paymentStatus: "refunded",
          cancelledAt: refundedAt,
          escrow: { ...reservedRide.escrow, refundTxid },
          updatedAt: refundedAt,
        }
      } else {
        ride = normalizeRide(refunded.snapshot.val() as LiveRide)
      }
      void refreshChainWallets([
        {
          role: "passenger",
          uid: passengerId,
          address: reservedRide.escrow.passengerAddress,
        },
      ])
    }

    const writes: Record<string, unknown> = {
      [`passengerRides/${passengerId}/${rideId}/status`]: "cancelled",
    }
    if (ride.driverId) {
      writes[`drivers/${ride.driverId}/available`] = true
      writes[`drivers/${ride.driverId}/assignedRideId`] = null
      writes[`drivers/${ride.driverId}/updatedAt`] = Date.now()
      writes[`driverRequests/${ride.driverId}/${rideId}/status`] = "cancelled"
    }
    if (ride.escrow?.refundTxid) {
      writes[
        `roleLedgers/passenger/${passengerId}/${Date.now()}_ride_refund_${rideId.slice(-8)}`
      ] = {
        type: "on_chain_escrow_refund",
        amountSats: ride.escrow.fundingSats - ride.escrow.releaseFeeSats,
        txid: ride.escrow.refundTxid,
        referenceType: "pasada_ride",
        referenceId: rideId,
        createdAt: Date.now(),
      }
    }
    await update(ref(db), writes)
    return true
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Escrow refund failed."
    if (refundTxid) {
      await update(ref(db, `rides/${rideId}`), {
        status: "cancelled",
        paymentStatus: "refunded",
        cancelledAt: Date.now(),
        [`escrow/refundTxid`]: refundTxid,
        [`escrow/error`]: message,
        updatedAt: Date.now(),
      })
      return true
    }
    if (reservedRide.escrow && !reservedRide.demoMode) {
      await runTransaction(
        ref(db, `rides/${rideId}`),
        (current: LiveRide | null) => {
          if (
            !current ||
            current.passengerId !== passengerId ||
            current.status !== "completing"
          )
            return
          return {
            ...current,
            status: reservedRide.status,
            paymentStatus: "funded",
            escrow: { ...reservedRide.escrow!, error: message },
            updatedAt: Date.now(),
          }
        },
      )
    }
    throw new Error(message)
  }
}

async function animateDemoRide(driverId: string, rideId: string) {
  await delay(900)
  if (!(await acceptRide(driverId, rideId))) return
  await delay(700)
  await setRideStatus(driverId, rideId, "accepted", "arriving")
  const db = roleDatabase("passenger")
  const snapshot = await get(ref(db, `rides/${rideId}`))
  const ride = normalizeRide(snapshot.val() as LiveRide)

  for (let step = 1; step <= 14; step += 1) {
    await delay(360)
    const progress = step / 14
    const location = interpolatePoint(DEMO_DRIVER_START, ride.pickup, progress)
    await update(ref(db), {
      [`drivers/${driverId}/location`]: location,
      [`drivers/${driverId}/updatedAt`]: Date.now(),
      [`rides/${rideId}/driver/location`]: location,
      [`rides/${rideId}/demoDriverApproachProgress`]: progress,
      [`rides/${rideId}/updatedAt`]: Date.now(),
    })
  }

  if (!(await setRideStatus(driverId, rideId, "arriving", "awaiting_pin")))
    return
  await delay(1_500)
  const refreshed = await get(ref(db, `rides/${rideId}`))
  const pin = String((refreshed.val() as LiveRide).pin)
  if (!(await verifyRidePin(driverId, rideId, pin))) return

  for (let step = 1; step <= 22; step += 1) {
    await delay(360)
    const progress = step / 22
    const location = interpolatePoint(ride.pickup, ride.destination, progress)
    await update(ref(db), {
      [`drivers/${driverId}/location`]: location,
      [`drivers/${driverId}/updatedAt`]: Date.now(),
      [`rides/${rideId}/driver/location`]: location,
      [`rides/${rideId}/progress`]: progress,
      [`rides/${rideId}/updatedAt`]: Date.now(),
    })
  }
  await completeRide(driverId, rideId)
}

export async function dispatchOldestWaitingRide(db: Database): Promise<void> {
  const snapshot = await get(ref(db, "rides"))
  if (!snapshot.exists()) return
  const rideRecords = Object.values(
    snapshot.val() as Record<string, LiveRide>,
  ).map(normalizeRide)
  const reconciledRides = await Promise.all(
    rideRecords.map((ride) => reconcileSearchingRideAssignment(db, ride)),
  )
  const rides = reconciledRides
    .filter((ride) => ride.status === "searching" && !ride.driverId)
    .sort((left, right) => left.createdAt - right.createdAt)
  for (const ride of rides) if (await dispatchRide(db, ride.id)) return
}

async function dispatchRide(
  db: Database,
  rideId: string,
  preferredDriverId?: string,
): Promise<boolean> {
  const [rideSnapshot, driversSnapshot] = await Promise.all([
    get(ref(db, `rides/${rideId}`)),
    get(ref(db, "drivers")),
  ])
  if (!rideSnapshot.exists() || !driversSnapshot.exists()) return false
  const ride = normalizeRide(rideSnapshot.val() as LiveRide)
  if (ride.status !== "searching" || ride.driverId) return false

  const driverRecords = Object.values(
    driversSnapshot.val() as Record<string, LiveDriver>,
  )
  const reconciledDrivers = await Promise.all(
    driverRecords.map((driver) => reconcileDriverForDispatch(db, driver)),
  )
  const drivers = reconciledDrivers
    .filter((driver): driver is LiveDriver => Boolean(driver))
    .filter(
      (driver) =>
        (!preferredDriverId || driver.id === preferredDriverId) &&
        driver.online &&
        Date.now() - Number(driver.updatedAt ?? 0) <
          DRIVER_HEARTBEAT_TIMEOUT_MS &&
        driver.available &&
        !driver.assignedRideId &&
        driver.location &&
        !wasDriverRecentlyRejected(ride, driver.id),
    )
    .sort(
      (left, right) =>
        distanceKm(left.location, ride.pickup) -
        distanceKm(right.location, ride.pickup),
    )

  for (const candidate of drivers) {
    const claim = await runTransaction(
      ref(db, `drivers/${candidate.id}`),
      (driver: LiveDriver | null) => {
        if (!driver?.online || !driver.available || driver.assignedRideId)
          return
        return {
          ...driver,
          available: false,
          assignedRideId: rideId,
          updatedAt: Date.now(),
        }
      },
    )
    if (!claim.committed) continue

    const claimed = claim.snapshot.val() as LiveDriver
    const assignment = await runTransaction(
      ref(db, `rides/${rideId}`),
      (current: LiveRide | null) => {
        if (!current || current.status !== "searching" || current.driverId)
          return
        return {
          ...current,
          driverId: claimed.id,
          driverName: claimed.name,
          driver: claimed,
          distanceToPickupKm:
            Math.round(distanceKm(claimed.location, current.pickup) * 10) / 10,
          updatedAt: Date.now(),
        }
      },
    )
    if (!assignment.committed) {
      await update(ref(db, `drivers/${candidate.id}`), {
        available: true,
        assignedRideId: null,
        updatedAt: Date.now(),
      })
      return false
    }

    const assignedRide = assignment.snapshot.val() as LiveRide
    await update(ref(db), {
      [`driverRequests/${candidate.id}/${rideId}`]: {
        rideId,
        passengerId: assignedRide.passengerId,
        passengerName: assignedRide.passengerName,
        from: assignedRide.from,
        to: assignedRide.to,
        distanceToPickupKm: assignedRide.distanceToPickupKm,
        tripDistanceKm: assignedRide.distanceKm,
        fareSats: assignedRide.fareSats,
        total: assignedRide.total,
        method: assignedRide.method,
        status: "pending",
        createdAt: assignedRide.createdAt,
      },
    })
    return true
  }
  return false
}

function wasDriverRecentlyRejected(ride: LiveRide, driverId: string): boolean {
  const rejection = ride.rejectedDriverIds?.[driverId]
  if (!rejection) return false
  const rejectedAt = typeof rejection === "number" ? rejection : ride.updatedAt
  return Date.now() - rejectedAt < DRIVER_REOFFER_COOLDOWN_MS
}

async function reconcileSearchingRideAssignment(
  db: Database,
  ride: LiveRide,
): Promise<LiveRide> {
  if (ride.status !== "searching" || !ride.driverId) return ride

  const driverSnapshot = await get(ref(db, `drivers/${ride.driverId}`))
  const driver = driverSnapshot.exists()
    ? driverSnapshot.val() as LiveDriver
    : null
  const driverIsActive = Boolean(
    driver?.online &&
      driver.assignedRideId === ride.id &&
      Date.now() - Number(driver.updatedAt ?? 0) < DRIVER_HEARTBEAT_TIMEOUT_MS,
  )
  if (driverIsActive) return ride

  const released = await runTransaction(
    ref(db, `rides/${ride.id}`),
    (current: LiveRide | null) => {
      if (
        !current ||
        current.status !== "searching" ||
        current.driverId !== ride.driverId
      )
        return
      return {
        ...current,
        driverId: null,
        driverName: null,
        driver: null,
        distanceToPickupKm: null,
        updatedAt: Date.now(),
      }
    },
  )
  if (!released.committed) return ride

  if (driver?.id && driver.assignedRideId === ride.id) {
    await runTransaction(
      ref(db, `drivers/${driver.id}`),
      (current: LiveDriver | null) => {
        if (!current || current.assignedRideId !== ride.id) return
        return {
          ...current,
          available: Boolean(current.online),
          assignedRideId: null,
          updatedAt: Date.now(),
        }
      },
    )
  }
  return normalizeRide(released.snapshot.val() as LiveRide)
}

async function reconcileDriverForDispatch(
  db: Database,
  driver: LiveDriver,
): Promise<LiveDriver | null> {
  if (!driver?.id || !driver.online) return driver ?? null

  let staleAssignment = false
  if (driver.assignedRideId) {
    const assignedSnapshot = await get(
      ref(db, `rides/${driver.assignedRideId}`),
    )
    const assignedRide = assignedSnapshot.exists()
      ? normalizeRide(assignedSnapshot.val() as LiveRide)
      : null
    staleAssignment =
      !assignedRide ||
      assignedRide.driverId !== driver.id ||
      ["settled", "cancelled"].includes(assignedRide.status)
  }

  const needsRepair =
    staleAssignment || (!driver.assignedRideId && !driver.available)
  if (!needsRepair) return driver

  const observedAssignment = driver.assignedRideId ?? null
  const repaired = await runTransaction(
    ref(db, `drivers/${driver.id}`),
    (current: LiveDriver | null) => {
      if (
        !current?.online ||
        (current.assignedRideId ?? null) !== observedAssignment
      )
        return
      return {
        ...current,
        available: true,
        assignedRideId: null,
        updatedAt: Date.now(),
      }
    },
  )
  return repaired.committed ? repaired.snapshot.val() as LiveDriver : driver
}

function normalizeRide(ride: LiveRide): LiveRide {
  const paymentStatus = [
    "awaiting_driver",
    "funding",
    "funding_broadcasting",
    "funded",
    "settling",
    "refunded",
    "settled",
    "failed",
  ].includes(String(ride.paymentStatus))
    ? ride.paymentStatus
    : ride.status === "settled"
      ? "settled"
      : ride.status === "cancelled"
        ? "refunded"
        : "awaiting_driver"
  return {
    ...ride,
    method: "bch",
    paymentStatus,
    passengerBchAddress: ride.passengerBchAddress ?? "",
    passengerPublicKey: ride.passengerPublicKey ?? "",
    driverId: ride.driverId ?? null,
    driverName: ride.driverName ?? null,
    driver: ride.driver ?? null,
    distanceToPickupKm: ride.distanceToPickupKm ?? null,
    progress: ride.progress ?? 0,
    fareSats: ride.fareSats ?? toSatoshis(ride.total, ride.config),
    transportationFareSats:
      ride.transportationFareSats ??
      Math.max(
        0,
        toSatoshis(ride.total, ride.config) -
          toSatoshis(ride.platformFee, ride.config),
      ),
    platformFeeSats:
      ride.platformFeeSats ?? toSatoshis(ride.platformFee, ride.config),
    platformTaxSats: ride.platformTaxSats ?? 0,
    driverPayoutSats:
      ride.driverPayoutSats ??
      Math.max(
        0,
        toSatoshis(ride.total, ride.config) -
          toSatoshis(ride.platformFee, ride.config),
      ),
    platformAccountId: ride.platformAccountId ?? PLATFORM_ACCOUNT_ID,
    platformBchAddress: ride.platformBchAddress ?? null,
    rejectedDriverIds: ride.rejectedDriverIds ?? {},
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
