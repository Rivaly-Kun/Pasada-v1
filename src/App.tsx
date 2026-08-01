import { useEffect, useState, type ReactNode } from "react"
import AdminApp from "./apps/admin/AdminApp"
import DriverApp from "./apps/driver/DriverApp"
import PassengerApp from "./apps/passenger/PassengerApp"
import EscrowFundingCoordinator from "./components/EscrowFundingCoordinator"
import RoleAuthGate from "./components/RoleAuthGate"
import { DEFAULT_FARE_CONFIG } from "./lib/fare"
import {
  ensurePlatformState,
  publishPlatformFareConfig,
  subscribePlatformFareConfig,
} from "./lib/platform-service"
import type { FareConfig } from "./lib/types"

type View = "passenger" | "driver" | "admin"

const VIEWS: { id: View label: string blurb: string }[] = [
  {
    id: "passenger",
    label: "Passenger",
    blurb: "Book a ride and fund BCH escrow",
  },
  {
    id: "driver",
    label: "Driver",
    blurb: "Accept rides and receive BCH payouts",
  },
  { id: "admin", label: "Admin", blurb: "Users, fares, contracts" },
]

export default function App() {
  return <PasadaDashboard />
}

function PasadaDashboard() {
  const [view, setView] = useState<View>("passenger")
  const [fareConfig, setFareConfig] = useState<FareConfig>(DEFAULT_FARE_CONFIG)

  useEffect(() => {
    void ensurePlatformState().catch(() => undefined)
    return subscribePlatformFareConfig(setFareConfig)
  }, [])

  const publishFareConfig = (config: FareConfig) => {
    setFareConfig(config)
    void publishPlatformFareConfig(config).catch(() => undefined)
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <EscrowFundingCoordinator />
      <header className="sticky top-0 z-50 border-b border-ink-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-lg font-black tracking-tight">
              PASADA
            </span>
            <span className="hidden font-mono text-[10px] tracking-[0.14em] text-ink-300 uppercase sm:inline">
              Ormoc City · tricycle
            </span>
          </div>

          <nav className="ml-auto flex items-center gap-1 rounded-full bg-ink-50 p-1">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-current={view === v.id ? "page" : undefined}
                className={`rounded-full px-4 py-2 font-display text-[13px] font-bold transition-colors ${
                  view === v.id
                    ? "bg-ink text-white"
                    : "text-ink-500 hover:text-ink"
                }`}
              >
                {v.label}
              </button>
            ))}
          </nav>

          <p className="hidden text-[11px] text-ink-300 lg:block">
            {VIEWS.find((v) => v.id === view)?.blurb} · rates{" "}
            {fareConfig.version}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-5 py-8 lg:py-12">
        {view === "admin" ? (
          <AdminApp fareConfig={fareConfig} setFareConfig={publishFareConfig} />
        ) : (
          <div className="flex justify-center">
            <AppColumn
              label={
                view === "passenger"
                  ? "Passenger application"
                  : "Driver application"
              }
            >
              {view === "passenger" ? (
                <RoleAuthGate role="passenger">
                  {(account) => (
                    <PassengerApp fareConfig={fareConfig} account={account} />
                  )}
                </RoleAuthGate>
              ) : (
                <RoleAuthGate role="driver">
                  {(account) => (
                    <DriverApp fareConfig={fareConfig} account={account} />
                  )}
                </RoleAuthGate>
              )}
            </AppColumn>
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1240px] px-5 pb-10 text-[11px] leading-relaxed text-ink-300">
        Prototype. Fare amounts follow Ormoc City Ordinance No. 121, s. 2023,
        but PASADA measures the 2.5 km base distance from the passenger&apos;s
        pickup point rather than the Ormoc City Stage — an adaptation that
        requires validation by the appropriate city transport authority.
      </footer>
    </div>
  )
}

function AppColumn({ label, children }: { label: string children: ReactNode }) {
  return (
    <section className="w-full max-w-[400px]">
      <p className="mb-3 text-center font-mono text-[10px] tracking-[0.16em] text-ink-300 uppercase">
        {label}
      </p>
      {children}
    </section>
  )
}
