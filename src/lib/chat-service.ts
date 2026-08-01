import {
  onDisconnect,
  onValue,
  push,
  ref,
  set,
  type Unsubscribe,
} from "firebase/database"
import { getScopedFirebase, type AppRole } from "./firebase"
import type { LiveRide } from "./types"

export type RideMessage = {
  id: string
  senderId: string
  senderName: string
  senderRole: AppRole
  text: string
  createdAt: number
}

export type ChatPresence = {
  online: boolean
  updatedAt: number
}

function isRideParty(role: AppRole, uid: string, ride: LiveRide) {
  return role === "passenger"
    ? ride.passengerId === uid
    : ride.driverId === uid
}

/** One private room per passenger/driver pair, even if they shared many rides. */
export function roomIdForRide(ride: LiveRide): string {
  if (!ride.driverId) {
    throw new Error("A driver must be assigned before a chat can open.")
  }
  return [ride.passengerId, ride.driverId]
    .sort()
    .map((uid) =>
      uid.replace(/[.#$\[\]/]/g, (character) =>
        `%${character.charCodeAt(0).toString(16)}`,
      ),
    )
    .join("__")
}

export function markRoomAsRead(uid: string, roomId: string): void {
  try {
    localStorage.setItem(`pasada_last_read_${uid}_${roomId}`, String(Date.now()))
  } catch {
    // Ignore localStorage errors
  }
}

export function subscribeUnreadMessages({
  role,
  uid,
  rides,
  onUnreadChange,
}: {
  role: AppRole
  uid: string
  rides: LiveRide[]
  onUnreadChange: (unreadRooms: Record<string, boolean>) => void
}): Unsubscribe {
  const { database } = getScopedFirebase(role)

  const chatRides = rides.filter(
    (ride) =>
      Boolean(ride.driverId) &&
      Boolean(ride.passengerId) &&
      (role === "passenger" ? ride.passengerId === uid : ride.driverId === uid),
  )

  const latestByPeer = new Map<string, LiveRide>()
  for (const ride of chatRides) {
    const peerId = role === "passenger" ? ride.driverId! : ride.passengerId
    if (!latestByPeer.has(peerId)) {
      latestByPeer.set(peerId, ride)
    }
  }

  const roomIds = Array.from(latestByPeer.values()).map((r) => roomIdForRide(r))

  if (roomIds.length === 0) {
    onUnreadChange({})
    return () => {}
  }

  const unreadState: Record<string, boolean> = {}
  const unsubscribes: Unsubscribe[] = []

  for (const roomId of roomIds) {
    const roomRef = ref(database, `rideMessages/${roomId}`)
    const unsub = onValue(roomRef, (snapshot) => {
      const lastRead = Number(
        localStorage.getItem(`pasada_last_read_${uid}_${roomId}`) || 0,
      )
      const raw = (snapshot.val() ?? {}) as Record<string, Omit<RideMessage, "id">>
      const messageList = Object.values(raw)
      const hasUnread = messageList.some(
        (m) => m.senderId !== uid && m.createdAt > lastRead,
      )
      unreadState[roomId] = hasUnread
      onUnreadChange({ ...unreadState })
    })
    unsubscribes.push(unsub)
  }

  return () => {
    for (const unsub of unsubscribes) {
      unsub()
    }
  }
}

/** Marks an authenticated rider as available for messages while their app is open. */
export async function setChatPresence(
  role: AppRole,
  uid: string,
  online: boolean,
): Promise<void> {
  const { database } = getScopedFirebase(role)
  const presenceRef = ref(database, `chatPresence/${role}/${uid}`)
  const value: ChatPresence = { online, updatedAt: Date.now() }
  if (online) {
    await onDisconnect(presenceRef).set({ online: false, updatedAt: Date.now() })
  } else {
    await onDisconnect(presenceRef).cancel()
  }
  await set(presenceRef, value)
}

export function subscribeChatPresence(
  role: AppRole,
  uid: string,
  callback: (presence: ChatPresence) => void,
): Unsubscribe {
  const { database } = getScopedFirebase(role)
  return onValue(ref(database, `chatPresence/${role}/${uid}`), (snapshot) => {
    const value = snapshot.val() as ChatPresence | null
    callback(value ?? { online: false, updatedAt: 0 })
  })
}

export function subscribeRideMessages(
  role: AppRole,
  ride: LiveRide,
  callback: (messages: RideMessage[]) => void,
): Unsubscribe {
  const { database } = getScopedFirebase(role)
  return onValue(
    ref(database, `rideMessages/${roomIdForRide(ride)}`),
    (snapshot) => {
    const raw = (snapshot.val() ?? {}) as Record<string, Omit<RideMessage, "id">>
    callback(
      Object.entries(raw)
        .map(([id, message]) => ({ id, ...message }))
        .sort((a, b) => a.createdAt - b.createdAt),
    )
    },
  )
}

/** Sends a short message in a room only exposed from a completed shared ride. */
export async function sendRideMessage({
  role,
  uid,
  name,
  ride,
  text,
}: {
  role: AppRole
  uid: string
  name: string
  ride: LiveRide
  text: string
}): Promise<void> {
  const message = text.trim()
  if (!isRideParty(role, uid, ride)) {
    throw new Error("This message room is available only to the riders on this trip.")
  }
  if (!message) return
  if (message.length > 500) {
    throw new Error("Messages can be up to 500 characters.")
  }
  const { database } = getScopedFirebase(role)
  const messageRef = push(ref(database, `rideMessages/${roomIdForRide(ride)}`))
  await set(messageRef, {
    senderId: uid,
    senderName: name.trim() || "PASADA rider",
    senderRole: role,
    text: message,
    createdAt: Date.now(),
  })
}
