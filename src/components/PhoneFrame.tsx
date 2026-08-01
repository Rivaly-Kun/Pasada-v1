import type { ReactNode } from 'react'

export function PhoneFrame({ children, chrome }: { children: ReactNode; chrome?: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      <div className="relative h-[812px] overflow-hidden rounded-[38px] bg-white shadow-[0_40px_90px_-30px_rgba(11,11,12,0.55)] ring-1 ring-ink/10">
        <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-7 pt-3 pb-1 text-[11px] font-semibold text-white mix-blend-difference">
          <span className="num">9:41</span>
          <span className="num tracking-[0.1em]">{chrome ?? 'PASADA'}</span>
          <span className="num">100%</span>
        </div>
        {children}
      </div>
    </div>
  )
}

export interface NavItem {
  id: string
  label: string
  icon: ReactNode
}

export function BottomNav({
  items,
  active,
  onSelect,
}: {
  items: NavItem[]
  active: string
  onSelect: (id: string) => void
}) {
  return (
    <nav className="absolute inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-ink-100 bg-white/95 px-2 pt-2 pb-5 backdrop-blur">
      {items.map((item) => {
        const on = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={on ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${on ? 'text-ink' : 'text-ink-300 hover:text-ink-500'}`}
          >
            <span className={on ? 'scale-110 transition-transform' : 'transition-transform'}>
              {item.icon}
            </span>
            <span className="font-display text-[10px] font-bold tracking-[0.04em]">
              {item.label}
            </span>
            <span className={`h-0.5 w-5 rounded-full ${on ? 'bg-pasada-red' : 'bg-transparent'}`} />
          </button>
        )
      })}
    </nav>
  )
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const Icons = {
  home: (
    <svg width="21" height="21" viewBox="0 0 24 24" {...stroke}>
      <path d="M3 10.5 12 3l9 7.5V21H3z" />
    </svg>
  ),
  pay: (
    <svg width="21" height="21" viewBox="0 0 24 24" {...stroke}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19M6 14.5h4" />
    </svg>
  ),
  activity: (
    <svg width="21" height="21" viewBox="0 0 24 24" {...stroke}>
      <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
    </svg>
  ),
  settings: (
    <svg width="21" height="21" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </svg>
  ),
  trike: (
    <svg width="30" height="30" viewBox="0 0 32 32" {...stroke} strokeWidth={1.7}>
      <circle cx="7" cy="24" r="3.6" />
      <circle cx="25" cy="24" r="3.6" />
      <path d="M7 20.4V13h7l3-5h5l2.5 7.5V20.4" />
      <path d="M14 13v11M17 8l-3 5" />
    </svg>
  ),
}
