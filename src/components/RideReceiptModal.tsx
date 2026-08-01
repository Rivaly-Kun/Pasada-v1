import { formatBchFromSats, formatPeso } from "../lib/fare"
import type { LiveRide } from "../lib/types"

export default function RideReceiptModal({
  ride,
  role,
  onClose,
  onMessage,
}: {
  ride: LiveRide
  role: "passenger" | "driver"
  onClose: () => void
  onMessage?: () => void
}) {
  const succeeded = ride.status === "settled"
  const otherName =
    role === "passenger"
      ? ride.driverName || "Former driver"
      : ride.passengerName || "Former passenger"
  const txid = ride.onChainTxid ?? ride.escrow?.settlementTxid ?? ride.escrow?.fundingTxid

  return (
    <div className="absolute inset-0 z-[60] flex items-end bg-ink/55 p-3 backdrop-blur-[2px]">
      <section className="scroll-quiet max-h-[94%] w-full overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] text-pasada-blue uppercase">PASADA ride receipt</p>
            <h2 className="mt-1 font-display text-xl font-extrabold">{succeeded ? "Trip settled" : "Ride cancelled"}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-ink-50 text-lg text-ink-500 hover:text-ink" aria-label="Close receipt">×</button>
        </div>

        <div className="mt-5 rounded-2xl bg-ink p-5 text-white">
          <p className="font-mono text-[10px] tracking-[0.14em] text-white/45 uppercase">Total fare</p>
          <p className="num mt-1 text-4xl font-medium">{formatPeso(ride.total)}</p>
          <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-white/60">
            <span>{ride.method.toUpperCase()} escrow</span>
            <span>{new Date(ride.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-ink-50 p-4">
          <p className="font-display text-[13px] font-bold">Your route</p>
          <div className="mt-3 flex gap-3">
            <div className="mt-1 flex flex-col items-center"><span className="h-2.5 w-2.5 rounded-full bg-pasada-blue" /><span className="h-8 border-l border-dashed border-ink-300" /><span className="h-2.5 w-2.5 rounded-full bg-pasada-red" /></div>
            <div className="min-w-0 space-y-5 text-[12px]"><p className="truncate"><span className="text-ink-400">From</span><br /><span className="font-semibold">{ride.from}</span></p><p className="truncate"><span className="text-ink-400">To</span><br /><span className="font-semibold">{ride.to}</span></p></div>
          </div>
        </div>

        <div className="mt-4 divide-y divide-ink-100 rounded-2xl bg-white px-4 ring-1 ring-ink-100">
          <ReceiptRow label="Distance" value={`${ride.distanceKm} km`} />
          <ReceiptRow label="Fare paid" value={formatPeso(ride.total)} />
          <ReceiptRow label="Escrow amount" value={`${formatBchFromSats(ride.fareSats)} BCH`} />
          <ReceiptRow label="PASADA rate" value={ride.config.version} />
          <ReceiptRow label={role === "passenger" ? "Driver" : "Passenger"} value={otherName} />
        </div>

        <div className="mt-4 rounded-2xl border border-pasada-blue/20 bg-pasada-blue/5 p-4">
          <p className="font-mono text-[9px] font-bold tracking-[0.13em] text-pasada-blue uppercase">BCH ESCROW {succeeded ? "SETTLED" : "RECORD"}</p>
          <p className="num mt-2 break-all text-[10px] leading-relaxed text-ink-500">{txid || "No on-chain transaction was needed for this cancelled or demo ride."}</p>
          <p className="mt-2 text-[10px] text-ink-500">Ride ID · {ride.id}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-ink-100 py-3 text-[12px] font-bold text-ink-700">Done</button>
          <button type="button" onClick={onMessage} disabled={!onMessage} className="rounded-xl bg-pasada-red py-3 text-[12px] font-bold text-white disabled:bg-ink-100">Message {role === "passenger" ? "driver" : "passenger"}</button>
        </div>
      </section>
    </div>
  )
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-3 text-[11px]"><span className="text-ink-500">{label}</span><span className="max-w-[62%] truncate text-right font-medium text-ink-700">{value}</span></div>
}
