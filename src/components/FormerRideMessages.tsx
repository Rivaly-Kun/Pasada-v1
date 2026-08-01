import { useEffect, useMemo, useState } from "react"
import type { AppRole } from "../lib/firebase"
import {
  type ChatPresence,
  type RideMessage,
  markRoomAsRead,
  roomIdForRide,
  sendRideMessage,
  subscribeChatPresence,
  subscribeRideMessages,
  subscribeUnreadMessages,
} from "../lib/chat-service"
import type { LiveRide, PasadaAccount } from "../lib/types"

type Conversation = {
  ride: LiveRide
  peerId: string
  peerName: string
  peerRole: AppRole
}

function initialLetters(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export default function FormerRideMessages({
  role,
  account,
  rides,
  focusedRideId,
}: {
  role: AppRole
  account: PasadaAccount
  rides: LiveRide[]
  focusedRideId?: string | null
}) {
  const conversations = useMemo<Conversation[]>(() => {
    const completed = rides
      .filter(
        (ride) =>
          (ride.status === "settled" || ride.status === "cancelled") &&
          (role === "passenger"
            ? Boolean(ride.driverId)
            : Boolean(ride.passengerId)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)

    const latestByPeer = new Map<string, Conversation>()
    for (const ride of completed) {
      const peerId = role === "passenger" ? ride.driverId! : ride.passengerId
      if (latestByPeer.has(peerId)) continue
      latestByPeer.set(peerId, {
        ride,
        peerId,
        peerName:
          role === "passenger"
            ? ride.driverName || "Former driver"
            : ride.passengerName || "Former passenger",
        peerRole: role === "passenger" ? "driver" : "passenger",
      })
    }
    return [...latestByPeer.values()]
  }, [rides, role])
  const [activeRideId, setActiveRideId] = useState<string | null>(
    focusedRideId ?? null,
  )
  const [messages, setMessages] = useState<RideMessage[]>([])
  const [unreadRooms, setUnreadRooms] = useState<Record<string, boolean>>({})
  const [presence, setPresence] = useState<ChatPresence>({
    online: false,
    updatedAt: 0,
  })
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    return subscribeUnreadMessages({
      role,
      uid: account.uid,
      rides,
      onUnreadChange: setUnreadRooms,
    })
  }, [role, account.uid, rides])

  useEffect(() => {
    if (!focusedRideId) return
    const focusedRide = rides.find((ride) => ride.id === focusedRideId)
    const peerId =
      focusedRide &&
      (role === "passenger" ? focusedRide.driverId : focusedRide.passengerId)
    const conversation = conversations.find((item) => item.peerId === peerId)
    if (conversation) setActiveRideId(conversation.ride.id)
  }, [focusedRideId, conversations, rides, role])

  const active =
    conversations.find((item) => item.ride.id === activeRideId) ?? null

  useEffect(() => {
    if (!active) {
      setMessages([])
      return
    }
    try {
      const roomId = roomIdForRide(active.ride)
      markRoomAsRead(account.uid, roomId)
      setUnreadRooms((prev) => ({ ...prev, [roomId]: false }))
    } catch {
      // ignore
    }
    return subscribeRideMessages(role, active.ride, setMessages)
  }, [active?.ride.id, role, account.uid])

  useEffect(() => {
    if (!active) {
      setPresence({ online: false, updatedAt: 0 })
      return
    }
    return subscribeChatPresence(active.peerRole, active.peerId, setPresence)
  }, [active?.peerId, active?.peerRole])

  const selectConversation = (conversation: Conversation) => {
    try {
      const roomId = roomIdForRide(conversation.ride)
      markRoomAsRead(account.uid, roomId)
      setUnreadRooms((prev) => ({ ...prev, [roomId]: false }))
    } catch {
      // ignore
    }
    setActiveRideId(conversation.ride.id)
    setError("")
  }

  const send = async () => {
    if (!active || !draft.trim()) return
    setSending(true)
    setError("")
    try {
      await sendRideMessage({
        role,
        uid: account.uid,
        name: account.displayName,
        ride: active.ride,
        text: draft,
      })
      setDraft("")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Message could not be sent.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`scroll-quiet flex h-full flex-col bg-ink-50 px-5 pt-14 ${active ? "pb-[94px]" : "pb-24 overflow-y-auto"}`}>
      <div className="flex items-end justify-between gap-3 shrink-0">
        <div>
          <h1 className="font-display text-[26px] font-extrabold">Messages</h1>
          <p className="mt-1 text-[11px] text-ink-500">
            Contact only people you previously shared a ride with.
          </p>
        </div>
      </div>

      {!active && (
        <div className="mt-5 space-y-2">
          {conversations.map((conversation) => {
            let roomId = ""
            try {
              roomId = roomIdForRide(conversation.ride)
            } catch {
              // ignore
            }
            const hasUnread = Boolean(unreadRooms[roomId])
            return (
              <button
                key={conversation.ride.id}
                type="button"
                onClick={() => selectConversation(conversation)}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left transition-transform hover:-translate-y-0.5 relative"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink font-display text-[13px] font-bold text-white relative">
                  {initialLetters(conversation.peerName)}
                  {hasUnread && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pasada-red opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-pasada-red ring-2 ring-white" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between">
                    <span className="truncate font-display text-[14px] font-bold">
                      {conversation.peerName}
                    </span>
                    {hasUnread && (
                      <span className="rounded-full bg-pasada-red/10 px-2 py-0.5 text-[9px] font-bold text-pasada-red">
                        New
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                    {conversation.peerRole === "driver" ? "Former driver" : "Former passenger"}
                    {" · "}{conversation.ride.to}
                  </span>
                </span>
                <span className="text-ink-300">→</span>
              </button>
            )
          })}
          {conversations.length === 0 && (
            <div className="rounded-2xl bg-white p-5 text-center">
              <p className="font-display text-[14px] font-bold">No former ride contacts yet</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                After a ride is settled or cancelled, its passenger and driver can message here.
              </p>
            </div>
          )}
        </div>
      )}

      {active && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveRideId(null)}
              className="text-lg text-ink-500 hover:text-ink"
              aria-label="Back to conversations"
            >
              ←
            </button>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-ink font-display text-[11px] font-bold text-white">
              {initialLetters(active.peerName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13px] font-bold">{active.peerName}</span>
              <span className={`block text-[10px] ${presence.online ? "text-[#0a9d72]" : "text-ink-400"}`}>
                {presence.online ? "Connected now" : "Offline"}
              </span>
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-ink-50 p-3">
            {messages.length === 0 && (
              <p className="px-3 py-8 text-center text-[11px] leading-relaxed text-ink-500">
                This thread is for your past trip to {active.ride.to}.
              </p>
            )}
            {messages.map((message) => {
              const own = message.senderId === account.uid
              return (
                <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${own ? "rounded-br-sm bg-ink text-white" : "rounded-bl-sm bg-white text-ink-700"}`}>
                    {!own && <p className="mb-0.5 text-[9px] font-bold text-pasada-blue">{message.senderName}</p>}
                    <p>{message.text}</p>
                    <p className={`mt-1 text-right text-[8px] ${own ? "text-white/45" : "text-ink-300"}`}>
                      {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-ink-100 p-3 shrink-0">
            {error && <p className="mb-2 text-[10px] text-pasada-red">{error}</p>}
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void send()
                }}
                disabled={sending}
                maxLength={500}
                placeholder="Message about your ride…"
                className="min-w-0 flex-1 rounded-xl bg-ink-50 px-3 py-2.5 text-[12px] outline-none ring-1 ring-ink-100 placeholder:text-ink-300 focus:ring-pasada-blue disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || sending}
                className="rounded-xl bg-pasada-red px-3 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:bg-ink-100"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
