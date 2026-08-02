import { formatPeso, toBch } from "../lib/fare"
import type { FareBreakdown } from "../lib/types"
import { Row, SectionLabel } from "./ui"

export default function FareBreakdownList({
  breakdown,
  method,
  compact,
}: {
  breakdown: FareBreakdown
  method?: "bch"
  compact?: boolean
}) {
  const { config, input } = breakdown

  return (
    <div>
      {!compact && (
        <div className="mb-3 flex items-center justify-between border-b border-ink-100 pb-3">
          <SectionLabel>Fare breakdown</SectionLabel>
          <span className="num text-[10px] text-ink-300">
            {input.tripDistanceKm.toFixed(1)} km · config {config.version}
          </span>
        </div>
      )}

      <div className="divide-y divide-ink-100/70">
        {breakdown.lines.map((line) => (
          <Row
            key={line.label}
            label={line.label}
            detail={compact ? undefined : line.detail}
            value={formatPeso(line.amount)}
            tone={line.tone}
          />
        ))}
      </div>

      <div className="mt-1 flex items-end justify-between border-t-2 border-ink pt-3">
        <div>
          <p className="font-display text-[13px] font-bold">
            Final amount payable
          </p>
          {method === "bch" && (
            <p className="num mt-0.5 text-[11px] text-pasada-blue">
              ≈ {toBch(breakdown.total, breakdown.config)} BCH
            </p>
          )}
        </div>
        <p className="num text-2xl font-medium">
          {formatPeso(breakdown.total)}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-ink-100 text-center">
        <div className="bg-ink-50 px-3 py-2.5">
          <p className="font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
            Billable seats
          </p>
          <p className="num mt-1 text-lg font-medium">
            {breakdown.billableSeats}
          </p>
        </div>
        <div className="bg-ink-50 px-3 py-2.5">
          <p className="font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
            Declared passengers
          </p>
          <p className="num mt-1 text-lg font-medium">{input.passengers}</p>
        </div>
      </div>
    </div>
  )
}

export function BuyoutNotice() {
  return (
    <p className="mt-3 border-l-2 border-pasada-red bg-pasada-red/6 px-3 py-2.5 text-[11px] leading-relaxed text-ink-700">
      This is an exclusive tricycle booking. The fare includes four seats for
      up to four passengers, then adds a seat for each fifth or sixth passenger.
    </p>
  )
}
