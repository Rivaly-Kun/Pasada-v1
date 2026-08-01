import type { ReactNode } from 'react'

export function Pill({
  children,
  tone = 'ink',
}: {
  children: ReactNode
  tone?: 'ink' | 'red' | 'blue' | 'muted' | 'outline'
}) {
  const tones = {
    ink: 'bg-ink text-white',
    red: 'bg-pasada-red text-white',
    blue: 'bg-pasada-blue text-white',
    muted: 'bg-ink-100 text-ink-700',
    outline: 'border border-ink-100 text-ink-500',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.08em] uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  full,
  type = 'button',
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'red' | 'blue' | 'ghost' | 'outline'
  disabled?: boolean
  full?: boolean
  type?: 'button' | 'submit'
  ariaLabel?: string
}) {
  const variants = {
    primary: 'bg-ink text-white hover:bg-ink-700',
    red: 'bg-pasada-red text-white hover:bg-pasada-red-deep',
    blue: 'bg-pasada-blue text-white hover:bg-pasada-blue-deep',
    ghost: 'text-ink-500 hover:bg-ink-50 hover:text-ink',
    outline: 'border border-ink-100 text-ink hover:border-ink hover:bg-white',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-display text-[15px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-35 ${variants[variant]} ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-medium tracking-[0.16em] text-ink-300 uppercase">
      {children}
    </p>
  )
}

export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'red' | 'blue'
}) {
  return (
    <div className="relative overflow-hidden border-t-2 border-ink bg-white p-5">
      {accent && (
        <span
          className={`absolute top-0 left-0 h-0.5 w-12 ${accent === 'red' ? 'bg-pasada-red' : 'bg-pasada-blue'}`}
        />
      )}
      <p className="font-mono text-[10px] tracking-[0.14em] text-ink-500 uppercase">{label}</p>
      <p className="mt-3 font-display text-3xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-ink-500">{sub}</p>}
    </div>
  )
}

export function Row({
  label,
  value,
  detail,
  strong,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  strong?: boolean
  tone?: 'default' | 'muted' | 'credit' | 'platform'
}) {
  const valueTone =
    tone === 'credit' ? 'text-pasada-blue' : tone === 'platform' ? 'text-pasada-red' : 'text-ink'
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <p
          className={`text-[13px] ${strong ? 'font-display font-bold' : tone === 'muted' ? 'text-ink-500' : 'text-ink-700'}`}
        >
          {label}
        </p>
        {detail && <p className="mt-0.5 text-[11px] text-ink-300">{detail}</p>}
      </div>
      <p
        className={`num shrink-0 text-[13px] ${strong ? 'font-medium' : ''} ${tone === 'muted' ? 'text-ink-300' : valueTone}`}
      >
        {value}
      </p>
    </div>
  )
}

export function Txid({ value }: { value: string }) {
  return (
    <span className="num text-[11px] break-all text-pasada-blue">
      {value.slice(0, 10)}…{value.slice(-8)}
    </span>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.14em] text-ink-500 uppercase">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-ink-300">{hint}</p>}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  mono,
}: {
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-ink-100 bg-white px-3 py-2.5 text-[13px] transition-colors focus:border-pasada-blue focus:outline-none ${mono ? 'num' : ''}`}
    />
  )
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-4 py-2 text-left"
    >
      <span className="text-[13px] text-ink-700">{label}</span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-pasada-blue' : 'bg-ink-100'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-5.5' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}
