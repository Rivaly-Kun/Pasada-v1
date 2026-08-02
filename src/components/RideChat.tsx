import { useEffect, useState } from "react"
import type { AppRole } from "../lib/firebase"
import {
  archiveRideMessages,
  isRideChatActive,
  markRoomAsRead,
  roomIdForRide,
  sendRideMessage,
  subscribeRideMessages,
  type RideMessage,
} from "../lib/chat-service"
import type { LiveRide, PasadaAccount } from "../lib/types"

export default function RideChat({
  role,
  account,
  ride,
}: {
  role: AppRole
  account: PasadaAccount
  ride: LiveRide
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<RideMessage[]>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const active = isRideChatActive(ride)
  const peerName =
    role === "passenger"
      ? ride.driverName || "Driver"
      : ride.passengerName || "Passenger"

  useEffect(() => {
    if (!active) {
      setOpen(false)
      if (ride.status === "settled" || ride.status === "cancelled") {
        void archiveRideMessages(role, ride).catch(() => undefined)
      }
      return
    }
    const roomId = roomIdForRide(ride)
    markRoomAsRead(account.uid, roomId)
    return subscribeRideMessages(role, ride, setMessages)
  }, [account.uid, active, ride, role])

  const send = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    setError("")
    try {
      await sendRideMessage({
        role,
        uid: account.uid,
        name: account.displayName,
        ride,
        text: draft,
      })
      setDraft("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message could not be sent.")
    } finally {
      setSending(false)
    }
  }

  if (!active) return null

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-ink-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3.5 py-3 text-left"
      >
        <span>
          <span className="block text-[12px] font-bold">Message {peerName}</span>
          <span className="mt-0.5 block text-[10px] text-ink-400">
            Available for this ride only
          </span>
        </span>
        <span className="text-ink-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-ink-100">
          <div className="max-h-36 space-y-2 overflow-y-auto bg-ink-50 p-3">
            {messages.length === 0 && (
              <p className="py-3 text-center text-[10px] text-ink-400">
                Send a message about this ride.
              </p>
            )}
            {messages.map((message) => {
              const own = message.senderId === account.uid
              return (
                <div
                  key={message.id}
                  className={`flex ${own ? "justify-end" : "justify-start"}`}
                >
                  <p
                    className={`max-w-[84%] rounded-xl px-2.5 py-2 text-[11px] ${
                      own ? "bg-ink text-white" : "bg-white text-ink-700"
                    }`}
                  >
                    {message.text}
                  </p>
                </div>
              )
            })}
          </div>
          <div className="p-3">
            {error && <p className="mb-2 text-[10px] text-pasada-red">{error}</p>}
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void send()
                }}
                maxLength={500}
                placeholder="Message about this ride"
                className="min-w-0 flex-1 rounded-lg bg-ink-50 px-3 py-2 text-[11px] outline-none ring-1 ring-ink-100 focus:ring-pasada-blue"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || sending}
                className="rounded-lg bg-pasada-blue px-3 text-[11px] font-bold text-white disabled:bg-ink-100"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
