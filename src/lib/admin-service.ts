import {
  get,
  onValue,
  ref,
  update,
  type Unsubscribe,
} from "firebase/database"
import { getScopedFirebase } from "./firebase"
import type { FareConfig, LiveRide, ManagedUser } from "./types"

export type AdminManagedUser = ManagedUser & {
  email: string
  online: boolean
  activeRideId: string | null
}

export type AdminTransaction = {
  id: string
  txid: string
  kind: "settlement" | "refund" | "commission"
  amountSats: number
  createdAt: number
  referenceId: string
}

export type AdminOverview = {
  users: AdminManagedUser[]
  rides: LiveRide[]
  transactions: AdminTransaction[]
  onlineDrivers: number
  onlinePassengers: number
  activeRides: number
  pendingUsers: number
}

export type ContractConfig = {
  network: "chipnet"
  /** Public timeout-refund window used for new CashScript escrow contracts. */
  expiryMinutes: number
  updatedAt: number
  updatedBy: string
}

export type FareHistoryEntry = FareConfig & { publishedAt: number }

const EMPTY_OVERVIEW: AdminOverview = {
  users: [],
  rides: [],
  transactions: [],
  onlineDrivers: 0,
  onlinePassengers: 0,
  activeRides: 0,
  pendingUsers: 0,
}

function database() {
  return getScopedFirebase("admin").database
}

function entries<T>(value: unknown): Array<[string, T]> {
  return Object.entries((value ?? {}) as Record<string, T>)
}

function accountState(value: unknown): ManagedUser["state"] {
  return ["active", "pending", "suspended", "rejected"].includes(String(value))
    ? value as ManagedUser["state"]
    : "active"
}

export function subscribeAdminOverview(
  onOverview: (overview: AdminOverview) => void,
): Unsubscribe {
  const paths = [
    "users",
    "passengers",
    "drivers",
    "rides",
    "chatPresence",
    "platform/ledger",
    "roleLedgers/passenger",
    "roleLedgers/driver",
  ] as const
  const values: Record<string, unknown> = {}
  let ready = 0

  const emit = () => {
    if (ready < paths.length) return
    const profiles = values.users as Record<string, Record<string, unknown>> ?? {}
    const passengers = values.passengers as Record<string, Record<string, unknown>> ?? {}
    const drivers = values.drivers as Record<string, Record<string, unknown>> ?? {}
    const rides = entries<LiveRide>(values.rides)
      .map(([id, ride]) => ({ ...ride, id: ride.id || id }))
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    const presence = values.chatPresence as Record<string, Record<string, { online?: boolean }>> ?? {}
    const settledTrips = new Map<string, number>()
    const activeRideByUser = new Map<string, string>()
    for (const ride of rides) {
      if (ride.status === "settled") {
        settledTrips.set(ride.passengerId, (settledTrips.get(ride.passengerId) ?? 0) + 1)
        if (ride.driverId) settledTrips.set(ride.driverId, (settledTrips.get(ride.driverId) ?? 0) + 1)
      }
      if (!["settled", "cancelled"].includes(ride.status)) {
        activeRideByUser.set(ride.passengerId, ride.id)
        if (ride.driverId) activeRideByUser.set(ride.driverId, ride.id)
      }
    }

    const managedUsers: AdminManagedUser[] = [
      ...entries<Record<string, unknown>>(passengers).map(([id, profile]) => ({
        id,
        name: String(profile.displayName ?? profile.name ?? "Passenger"),
        email: String(profile.email ?? profiles[id]?.email ?? ""),
        kind: "passenger" as const,
        state: accountState(profile.accountStatus ?? (profiles[id]?.roleProfiles as Record<string, Record<string, unknown>> | undefined)?.passenger?.accountStatus),
        bchAddress: String(profile.bchAddress ?? ""),
        joined: new Date(Number(profile.createdAt ?? Date.now())).toLocaleDateString(),
        trips: settledTrips.get(id) ?? 0,
        online: Boolean(presence.passenger?.[id]?.online),
        activeRideId: activeRideByUser.get(id) ?? null,
      })),
      ...entries<Record<string, unknown>>(drivers).map(([id, profile]) => ({
        id,
        name: String(profile.displayName ?? profile.name ?? "Driver"),
        email: String(profile.email ?? profiles[id]?.email ?? ""),
        kind: "driver" as const,
        state: accountState(profile.accountStatus ?? (profiles[id]?.roleProfiles as Record<string, Record<string, unknown>> | undefined)?.driver?.accountStatus),
        bchAddress: String(profile.bchAddress ?? ""),
        joined: new Date(Number(profile.createdAt ?? Date.now())).toLocaleDateString(),
        trips: Number(profile.trips ?? settledTrips.get(id) ?? 0),
        vehicle: [profile.plate, profile.vehicleBody ?? profile.body].filter(Boolean).join(" · "),
        online: Boolean(profile.online),
        activeRideId:
          activeRideByUser.get(id) ??
          (String(profile.assignedRideId ?? "") || null),
      })),
    ].sort((a, b) => a.name.localeCompare(b.name))

    const transactions: AdminTransaction[] = []
    const addLedger = (ledger: unknown, kind: AdminTransaction["kind"]) => {
      entries<Record<string, unknown>>(ledger).forEach(([id, item]) => {
        const txid = String(item.txid ?? "")
        if (!txid) return
        transactions.push({
          id,
          txid,
          kind,
          amountSats: Number(item.amountSats ?? 0),
          createdAt: Number(item.createdAt ?? 0),
          referenceId: String(item.referenceId ?? ""),
        })
      })
    }
    addLedger(values["platform/ledger"], "commission")
    entries<Record<string, Record<string, unknown>>>(values["roleLedgers/passenger"])
      .forEach(([, ledger]) => addLedger(ledger, "refund"))
    entries<Record<string, Record<string, unknown>>>(values["roleLedgers/driver"])
      .forEach(([, ledger]) => addLedger(ledger, "settlement"))
    transactions.sort((a, b) => b.createdAt - a.createdAt)

    onOverview({
      users: managedUsers,
      rides,
      transactions,
      onlineDrivers: managedUsers.filter((user) => user.kind === "driver" && user.online).length,
      onlinePassengers: managedUsers.filter((user) => user.kind === "passenger" && user.online).length,
      activeRides: rides.filter((ride) => !["settled", "cancelled"].includes(ride.status)).length,
      pendingUsers: managedUsers.filter((user) => user.state === "pending").length,
    })
  }

  const unsubscribers = paths.map((path) =>
    onValue(ref(database(), path), (snapshot) => {
      if (!(path in values)) ready += 1
      values[path] = snapshot.exists() ? snapshot.val() : {}
      emit()
    }),
  )
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}

export async function setAdminUserState(
  user: AdminManagedUser,
  state: ManagedUser["state"],
) {
  if (user.activeRideId && state !== "active") {
    throw new Error("This account has an active ride. Finish or cancel it before restricting the account.")
  }
  const now = Date.now()
  const roleCollection = user.kind === "driver" ? "drivers" : "passengers"
  const writes: Record<string, unknown> = {
    [`${roleCollection}/${user.id}/accountStatus`]: state,
    [`${roleCollection}/${user.id}/updatedAt`]: now,
    [`users/${user.id}/roleProfiles/${user.kind}/accountStatus`]: state,
    [`users/${user.id}/roleProfiles/${user.kind}/updatedAt`]: now,
    [`adminAudit/${now}_${user.id.slice(-8)}`]: {
      action: "account_status_changed",
      targetUid: user.id,
      targetRole: user.kind,
      nextState: state,
      createdAt: now,
      adminUid: getScopedFirebase("admin").auth.currentUser?.uid ?? "unknown",
    },
  }
  if (user.kind === "driver" && state !== "active") {
    writes[`drivers/${user.id}/online`] = false
    writes[`drivers/${user.id}/available`] = false
  }
  await update(ref(database()), writes)
}

export function subscribeFareHistory(
  onHistory: (history: FareHistoryEntry[]) => void,
): Unsubscribe {
  return onValue(ref(database(), "platform/fareConfigHistory"), (snapshot) => {
    const history = entries<FareHistoryEntry>(snapshot.val())
      .map(([, item]) => item)
      .sort((a, b) => Number(b.publishedAt ?? 0) - Number(a.publishedAt ?? 0))
    onHistory(history)
  })
}

export function subscribeContractConfig(
  onConfig: (config: ContractConfig) => void,
): Unsubscribe {
  return onValue(ref(database(), "platform/contractConfig"), (snapshot) => {
    const value = snapshot.val() as Partial<ContractConfig> | null
    onConfig({
      network: "chipnet",
      expiryMinutes: Math.min(120, Math.max(5, Number(value?.expiryMinutes ?? 30))),
      updatedAt: Number(value?.updatedAt ?? 0),
      updatedBy: String(value?.updatedBy ?? ""),
    })
  })
}

export async function saveContractConfig(
  value: Pick<ContractConfig, "expiryMinutes">,
) {
  const expiryMinutes = Math.min(120, Math.max(5, Math.round(value.expiryMinutes)))
  const now = Date.now()
  const adminUid = getScopedFirebase("admin").auth.currentUser?.uid
  if (!adminUid) throw new Error("Log in as an administrator first.")
  const config: ContractConfig = {
    network: "chipnet",
    expiryMinutes,
    updatedAt: now,
    updatedBy: adminUid,
  }
  await update(ref(database()), {
    "platform/contractConfig": config,
    [`platform/contractConfigHistory/${now}`]: config,
    [`adminAudit/${now}_contract`]: {
      action: "contract_config_updated",
      ...config,
      adminUid,
      createdAt: now,
    },
  })
}

export async function verifyAdminRecord(uid: string) {
  const snapshot = await get(ref(database(), `admins/${uid}`))
  const value = snapshot.val() as Record<string, unknown> | null
  if (!value || value.active === false || value.role !== "admin") {
    throw new Error("This Firebase account is not authorized for PASADA administration.")
  }
  return value
}

export { EMPTY_OVERVIEW }
