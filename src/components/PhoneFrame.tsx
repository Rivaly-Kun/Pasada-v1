import type { ReactNode } from 'react'

export function PhoneFrame({
  children,
  variant = "app",
}: {
  children: ReactNode
  chrome?: string
  variant?: "app" | "auth"
}) {
  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      <div
        className={`relative h-[812px] overflow-hidden bg-white shadow-[0_40px_90px_-30px_rgba(11,11,12,0.55)] ${
          variant === "auth"
            ? "rounded-[42px] border-[6px] border-ink"
            : "rounded-[38px] ring-1 ring-ink/10"
        }`}
      >
        {children}
      </div>
    </div>
  )
}

export interface NavItem {
  id: string
  label: string
  icon: ReactNode
  badge?: boolean | number
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
    <nav className={`absolute inset-x-0 bottom-0 z-30 grid border-t border-ink-100 bg-white/95 px-2 pt-2 pb-5 backdrop-blur ${items.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
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
            <span className={`relative ${on ? 'scale-110 transition-transform' : 'transition-transform'}`}>
              {item.icon}
              {Boolean(item.badge) && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pasada-red opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pasada-red ring-2 ring-white" />
                </span>
              )}
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
  messages: (
    <svg width="21" height="21" viewBox="0 0 24 24" {...stroke}>
      <path d="M20.5 11.5a7.8 7.8 0 0 1-8.1 7.5 9.2 9.2 0 0 1-3.7-.8L3.5 20l1.3-4.2A7.1 7.1 0 0 1 3.5 11a7.8 7.8 0 0 1 8.1-7.5 7.8 7.8 0 0 1 8.9 8Z" />
      <path d="M8 11h.01M12 11h.01M16 11h.01" strokeWidth={2.8} />
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
