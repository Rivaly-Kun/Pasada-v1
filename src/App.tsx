import { useEffect, useState, type ReactNode } from "react"
import AdminApp from "./apps/admin/AdminApp"
import DriverApp from "./apps/driver/DriverApp"
import PassengerApp from "./apps/passenger/PassengerApp"
import AdminAuthGate from "./components/AdminAuthGate"
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

const VIEWS: { id: View label: string }[] = [
  { id: "passenger", label: "Passenger" },
  { id: "driver", label: "Driver" },
  { id: "admin", label: "Admin" },
]

export default function App() {
  return <PasadaDashboard />
}

function PasadaDashboard() {
  const [view, setView] = useState<View>("passenger")
  const [fareConfig, setFareConfig] = useState<FareConfig>(DEFAULT_FARE_CONFIG)
  const contentWidth = view === "admin" ? "max-w-[1600px]" : "max-w-[1240px]"

  useEffect(() => {
    document.title = "PASADA"
    void ensurePlatformState().catch(() => undefined)
    return subscribePlatformFareConfig(setFareConfig)
  }, [])

  const publishFareConfig = async (config: FareConfig) => {
    await publishPlatformFareConfig(config)
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <EscrowFundingCoordinator />
      <header className="sticky top-0 z-50 border-b border-ink-100 bg-white/85 backdrop-blur">
        <div
          className={`mx-auto flex ${contentWidth} flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3`}
        >
          <div className="flex items-center gap-2.5">
            <img
              src="/img/LOGO.svg"
              alt="PASADA"
              className="h-9 w-11 object-contain"
            />
            <span className="font-display text-lg font-black tracking-tight">
              PASADA
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
        </div>
      </header>

      <main
        className={`mx-auto ${contentWidth} px-4 py-8 sm:px-5 lg:px-8 lg:py-12`}
      >
        {view === "admin" ? (
          <AdminAuthGate>
            {({ user, logout }) => (
              <AdminApp
                fareConfig={fareConfig}
                setFareConfig={publishFareConfig}
                adminEmail={user.email ?? "Administrator"}
                onLogout={() => void logout()}
              />
            )}
          </AdminAuthGate>
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
