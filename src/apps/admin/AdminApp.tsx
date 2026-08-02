import { useEffect, useMemo, useState, type ReactNode } from "react"
import FareBreakdownList from "../../components/FareBreakdownList"
import {
  Button,
  Field,
  Pill,
  SectionLabel,
  StatTile,
  TextInput,
  Toggle,
  Txid,
} from "../../components/ui"
import {
  EMPTY_OVERVIEW,
  saveContractConfig,
  setAdminUserState,
  subscribeAdminOverview,
  subscribeContractConfig,
  subscribeFareHistory,
  type AdminManagedUser,
  type AdminOverview,
  type ContractConfig,
  type FareHistoryEntry,
} from "../../lib/admin-service"
import {
  calculateFare,
  formatBchFromSats,
  formatPeso,
  isNightHour,
  PESO,
  satoshisToCentavos,
  settlementOutputs,
  toSatoshis,
} from "../../lib/fare"
import {
  platformFeeAddress,
  setPlatformFeeAddress,
  subscribePlatformAccount,
  subscribePlatformMetrics,
  type PlatformAccount,
  type PlatformMetrics,
} from "../../lib/platform-service"
import type { FareConfig, LiveRide, ManagedUser } from "../../lib/types"
import {
  getLocalPasadaWalletSigningKey,
  hasLocalPasadaWalletKey,
  linkPasadaWalletSigningKey,
} from "../../lib/auth"
import { generateBchWallet } from "../../lib/bch-wallet"
import {
  PRC_COUPON_VALUE_PHP,
  PRC_INITIAL_SUPPLY,
  deriveTokenAddress,
  fetchCashTokenWalletSnapshot,
  grantCouponCredit,
  initializePrcToken,
  processReferralReward,
  subscribeCashTokenHub,
  type CashTokenHubState,
  type CashTokenWalletSnapshot,
} from "../../lib/cashtoken-service"

const SECTIONS = [
  "Overview",
  "Live rides",
  "Users",
  "Fare configuration",
  "CashToken Coupon Hub",
  "BCH contract",
] as const
type Section = typeof SECTIONS[number]

const activeRideStatuses = [
  "funding",
  "searching",
  "accepted",
  "arriving",
  "awaiting_pin",
  "in_transit",
  "completing",
]

export default function AdminApp({
  fareConfig,
  setFareConfig,
  adminEmail,
  onLogout,
}: {
  fareConfig: FareConfig
  setFareConfig: (config: FareConfig) => Promise<void>
  adminEmail: string
  onLogout: () => void
}) {
  const [section, setSection] = useState<Section>("Overview")
  const [overview, setOverview] = useState<AdminOverview>(EMPTY_OVERVIEW)
  const [loaded, setLoaded] = useState(false)
  const [platformAccount, setPlatformAccount] =
    useState<PlatformAccount | null>(null)
  const [metrics, setMetrics] = useState<PlatformMetrics>({
    totalRideSats: 0,
    totalPlatformFeeSats: 0,
    totalBchFeeSats: 0,
    settledRides: 0,
    bchRides: 0,
  })
  const [cashTokenState, setCashTokenState] = useState<CashTokenHubState>({
    config: null,
    activity: [],
    rewardClaims: [],
  })
  useEffect(() => {
    const stopOverview = subscribeAdminOverview((next) => {
      setOverview(next)
      setLoaded(true)
    })
    const stopAccount = subscribePlatformAccount(setPlatformAccount, "admin")
    const stopMetrics = subscribePlatformMetrics(setMetrics, "admin")
    const stopCashTokens = subscribeCashTokenHub(setCashTokenState, "admin")
    return () => {
      stopOverview()
      stopAccount()
      stopMetrics()
      stopCashTokens()
    }
  }, [])

  return (
    <div className="mx-auto grid min-h-[820px] w-full max-w-[1600px] grid-cols-1 overflow-hidden rounded-2xl bg-white shadow-[0_40px_90px_-40px_rgba(11,11,12,0.5)] ring-1 ring-ink/10 lg:grid-cols-[238px_minmax(0,1fr)]">
      <aside className="flex flex-col bg-ink px-4 py-6 text-white">
        <div className="flex items-center gap-3 px-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white">
            <img
              src="/img/LOGO.svg"
              alt="PASADA"
              className="h-7 w-8 object-contain"
            />
          </span>
          <div>
            <p className="font-display text-lg font-black tracking-tight">
              PASADA
            </p>
            <p className="font-mono text-[8px] tracking-[0.16em] text-white/40 uppercase">
              Admin console
            </p>
          </div>
        </div>

        <nav className="mt-7 space-y-0.5">
          {SECTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSection(item)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-display text-[13px] font-semibold transition-colors ${
                section === item
                  ? "bg-white text-ink"
                  : "text-white/55 hover:bg-white/8 hover:text-white"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  section === item ? "bg-pasada-red" : "bg-white/20"
                }`}
              />
              {item}
              {item === "Live rides" && overview.activeRides > 0 && (
                <span className="ml-auto rounded-full bg-pasada-red px-1.5 py-0.5 font-mono text-[8px] text-white">
                  {overview.activeRides}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-2">
          <div className="rounded-lg bg-white/6 p-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] tracking-[0.12em] text-white/40 uppercase">
                Network
              </p>
              <span className="h-2 w-2 rounded-full bg-[#0AC18E] shadow-[0_0_10px_#0AC18E]" />
            </div>
            <p className="mt-1 font-display text-[13px] font-bold">
              BCH Chipnet
            </p>
            <p className="num mt-0.5 text-[10px] text-white/40">
              rates {fareConfig.version} · live
            </p>
          </div>
          <div className="rounded-lg border border-white/8 p-3">
            <p className="truncate text-[10px] text-white/45">{adminEmail}</p>
            <button
              type="button"
              onClick={onLogout}
              className="mt-2 font-display text-[11px] font-bold text-white/75 transition-colors hover:text-white"
            >
              Sign out →
            </button>
          </div>
        </div>
      </aside>

      <main className="scroll-quiet min-w-0 max-h-[820px] overflow-y-auto bg-ink-50 p-5 sm:p-7">
        {!loaded ? (
          <div className="grid min-h-[700px] place-items-center text-center">
            <div>
              <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-ink-100 border-t-pasada-blue" />
              <p className="mt-4 font-mono text-[10px] tracking-[0.14em] text-ink-400 uppercase">
                Loading live operations
              </p>
            </div>
          </div>
        ) : section === "Overview" ? (
          <Dashboard
            overview={overview}
            account={platformAccount}
            metrics={metrics}
            fareConfig={fareConfig}
          />
        ) : section === "Live rides" ? (
          <Rides rides={overview.rides} fareConfig={fareConfig} />
        ) : section === "Users" ? (
          <Users users={overview.users} />
        ) : section === "Fare configuration" ? (
          <FareSection fareConfig={fareConfig} setFareConfig={setFareConfig} />
        ) : section === "CashToken Coupon Hub" ? (
          <CashTokenHub
            platformAccount={platformAccount}
            state={cashTokenState}
            passengers={overview.users.filter(
              (user) => user.kind === "passenger",
            )}
          />
        ) : (
          <ContractSection
            fareConfig={fareConfig}
            platformAccount={platformAccount}
            metrics={metrics}
          />
        )}
      </main>
    </div>
  )
}

function Header({
  title,
  sub,
  action,
}: {
  title: string
  sub: string
  action?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-ink-100 pb-5">
      <div>
        <h1 className="font-display text-[30px] leading-none font-extrabold">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-ink-500">{sub}</p>
      </div>
      {action ?? <Pill tone="blue">Chipnet · live</Pill>}
    </header>
  )
}

function Dashboard({
  overview,
  account,
  metrics,
  fareConfig,
}: {
  overview: AdminOverview
  account: PlatformAccount | null
  metrics: PlatformMetrics
  fareConfig: FareConfig
}) {
  const [issuerBalance, setIssuerBalance] = useState<number | null>(null)
  const [issuerBalanceError, setIssuerBalanceError] = useState("")
  const passengers = overview.users.filter(
    (user) => user.kind === "passenger",
  ).length
  const drivers = overview.users.filter((user) => user.kind === "driver").length

  useEffect(() => {
    const address = platformFeeAddress(account)
    if (!address) {
      setIssuerBalance(null)
      setIssuerBalanceError("")
      return
    }
    let active = true
    const refresh = async () => {
      try {
        const snapshot = await fetchCashTokenWalletSnapshot(address)
        if (!active) return
        setIssuerBalance(snapshot.bchSats)
        setIssuerBalanceError("")
      } catch {
        if (!active) return
        setIssuerBalance(null)
        setIssuerBalanceError("Could not read the live Chipnet balance.")
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account?.bchAddress, account?.feeAddress])

  return (
    <>
      <Header
        title="Operations overview"
        sub="Live Firebase activity across PASADA passengers, drivers, rides, and on-chain Chipnet settlements."
        action={
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 ring-1 ring-ink-100">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0AC18E] opacity-60" />
              <span className="relative h-2 w-2 rounded-full bg-[#0AC18E]" />
            </span>
            <span className="font-mono text-[9px] font-bold tracking-[0.1em] text-ink-500 uppercase">
              Realtime connected
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-ink-100 lg:grid-cols-4">
        <StatTile
          label="Passengers"
          value={passengers.toLocaleString()}
          sub={`${overview.onlinePassengers} online now`}
        />
        <StatTile
          label="Registered drivers"
          value={drivers.toLocaleString()}
          sub={`${overview.onlineDrivers} online now`}
          accent="blue"
        />
        <StatTile
          label="Active rides"
          value={String(overview.activeRides)}
          sub={`${overview.pendingUsers} pending accounts`}
          accent="red"
        />
        <StatTile
          label="Settled rides"
          value={String(metrics.settledRides)}
          sub="Live database total"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
        <section className="min-w-0">
          <div className="flex items-center justify-between">
            <SectionLabel>Recent blockchain transactions</SectionLabel>
            <span className="font-mono text-[9px] text-ink-300">
              {overview.transactions.length} ledger entries
            </span>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl bg-white">
            <table className="w-full min-w-[650px] text-left">
              <thead>
                <tr className="border-b border-ink-100 font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Txid</th>
                  <th className="px-4 py-3 text-right font-medium">Satoshis</th>
                  <th className="px-4 py-3 text-right font-medium">PHP est.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {overview.transactions.slice(0, 8).map((transaction) => (
                  <tr
                    key={`${transaction.kind}_${transaction.id}`}
                    className="transition-colors hover:bg-ink-50"
                  >
                    <td className="num whitespace-nowrap px-4 py-3 text-[11px] text-ink-500">
                      {formatDate(transaction.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Pill
                        tone={
                          transaction.kind === "refund"
                            ? "red"
                            : transaction.kind === "commission"
                              ? "blue"
                              : "muted"
                        }
                      >
                        {transaction.kind}
                      </Pill>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://chipnet.chaingraph.cash/tx/${transaction.txid}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Txid value={transaction.txid} />
                      </a>
                    </td>
                    <td className="num px-4 py-3 text-right text-[11px]">
                      {transaction.amountSats.toLocaleString()}
                    </td>
                    <td className="num px-4 py-3 text-right text-[11px] text-ink-500">
                      {formatPeso(
                        satoshisToCentavos(transaction.amountSats, fareConfig),
                      )}
                    </td>
                  </tr>
                ))}
                {!overview.transactions.length && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-[12px] text-ink-300"
                    >
                      No on-chain ledger entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          <div className="relative overflow-hidden rounded-xl bg-ink p-5 text-white">
            <span className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-pasada-blue/20 blur-2xl" />
            <p className="relative font-mono text-[9px] tracking-[0.14em] text-white/40 uppercase">
              Total settled ride value
            </p>
            <p className="num relative mt-2 break-words text-[clamp(1.45rem,2.1vw,1.875rem)] font-medium">
              {formatBchFromSats(metrics.totalRideSats)} BCH
            </p>
            <p className="relative mt-1 text-[10px] text-white/35">
              {formatPeso(
                satoshisToCentavos(metrics.totalRideSats, fareConfig),
              )}{" "}
              estimated
            </p>
            <div className="relative mt-4 space-y-2.5 border-t border-white/10 pt-4">
              <MetricLine
                label="Confirmed platform fees"
                value={`${metrics.totalPlatformFeeSats.toLocaleString()} sats`}
                color="text-pasada-red"
              />
              <MetricLine
                label="Chipnet settlements"
                value={`${metrics.bchRides} of ${metrics.settledRides}`}
                color="text-pasada-blue"
              />
            </div>
          </div>

          <div className="rounded-xl bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionLabel>Platform fee wallet</SectionLabel>
                <p className="mt-2 font-display text-[14px] font-bold">
                  {account?.displayName ?? "Loading account"}
                </p>
              </div>
              <Pill tone="blue">Chipnet</Pill>
            </div>
            <p className="num mt-3 text-[18px] font-medium text-pasada-blue">
              {issuerBalance === null
                ? "Checking…"
                : `${issuerBalance.toLocaleString()} sats`}
            </p>
            <p className="mt-1 text-[10px] text-ink-400">
              Confirmed, spendable BCH at the fee address
            </p>
            <p className="num mt-2 break-all text-[9px] leading-relaxed text-ink-300">
              {account ? platformFeeAddress(account) : "No address configured"}
            </p>
            {issuerBalanceError && (
              <p className="mt-2 text-[10px] text-pasada-red">
                {issuerBalanceError}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-white p-5">
            <SectionLabel>Latest rides</SectionLabel>
            <div className="mt-2 divide-y divide-ink-100">
              {overview.rides.slice(0, 4).map((ride) => (
                <div
                  key={ride.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold">
                      {ride.passengerName || "Passenger"} →{" "}
                      {ride.driverName || "Unassigned"}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-ink-300">
                      {ride.from} → {ride.to}
                    </p>
                  </div>
                  <RideStatus status={ride.status} />
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function MetricLine({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-white/50">{label}</span>
      <span className={`num text-[12px] ${color}`}>{value}</span>
    </div>
  )
}

function Rides({
  rides,
  fareConfig,
}: {
  rides: LiveRide[]
  fareConfig: FareConfig
}) {
  const [filter, setFilter] =
    useState<"all" | "active" | "settled" | "cancelled">("all")
  const [selected, setSelected] = useState<LiveRide | null>(rides[0] ?? null)
  const shown = rides.filter((ride) =>
    filter === "all"
      ? true
      : filter === "active"
        ? activeRideStatuses.includes(ride.status)
        : ride.status === filter,
  )
  return (
    <>
      <Header
        title="Live ride operations"
        sub="Inspect every booking, dispatch state, escrow amount, and settlement transaction directly from Firebase."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(["all", "active", "settled", "cancelled"] as const).map((item) => (
          <FilterButton
            key={item}
            active={filter === item}
            onClick={() => setFilter(item)}
          >
            {item} ·{" "}
            {
              rides.filter(
                (ride) =>
                  item === "all" ||
                  (item === "active"
                    ? activeRideStatuses.includes(ride.status)
                    : ride.status === item),
              ).length
            }
          </FilterButton>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_.75fr]">
        <div className="overflow-x-auto rounded-xl bg-white">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-ink-100 font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
                <th className="px-4 py-3 font-medium">Ride</th>
                <th className="px-4 py-3 font-medium">People</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Fare</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {shown.map((ride) => (
                <tr
                  key={ride.id}
                  onClick={() => setSelected(ride)}
                  className={`cursor-pointer transition-colors hover:bg-ink-50 ${
                    selected?.id === ride.id ? "bg-pasada-blue/5" : ""
                  }`}
                >
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate text-[12px] font-semibold">
                      {ride.from}
                    </p>
                    <p className="truncate text-[10px] text-ink-300">
                      to {ride.to}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[11px]">
                      {ride.passengerName || "Passenger"}
                    </p>
                    <p className="text-[10px] text-ink-300">
                      {ride.driverName || "Waiting for driver"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <RideStatus status={ride.status} />
                  </td>
                  <td className="num px-4 py-3 text-right text-[12px]">
                    {formatPeso(ride.total ?? 0)}
                  </td>
                  <td className="num whitespace-nowrap px-4 py-3 text-[10px] text-ink-300">
                    {formatDate(ride.createdAt)}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-[12px] text-ink-300"
                  >
                    No rides match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <RideInspector ride={selected} fareConfig={fareConfig} />
      </div>
    </>
  )
}

function RideInspector({
  ride,
  fareConfig,
}: {
  ride: LiveRide | null
  fareConfig: FareConfig
}) {
  if (!ride)
    return (
      <div className="rounded-xl bg-white p-5 text-[12px] text-ink-300">
        Select a ride to inspect it.
      </div>
    )
  const txid =
    ride.onChainTxid ??
    ride.escrow?.settlementTxid ??
    ride.escrow?.fundingTxid ??
    ride.escrow?.refundTxid
  return (
    <aside className="h-fit rounded-xl bg-white p-5 xl:sticky xl:top-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Ride record</SectionLabel>
          <p className="num mt-1 text-[11px] text-ink-500">{ride.id}</p>
        </div>
        <RideStatus status={ride.status} />
      </div>
      <div className="mt-4 rounded-xl bg-ink-50 p-3.5">
        <p className="text-[12px] font-semibold">{ride.from}</p>
        <div className="my-2 h-5 border-l border-dashed border-ink-300" />
        <p className="text-[12px] font-semibold">{ride.to}</p>
      </div>
      <div className="mt-3 divide-y divide-ink-100">
        <Detail label="Passenger" value={ride.passengerName || "—"} />
        <Detail label="Driver" value={ride.driverName || "Unassigned"} />
        <Detail
          label="Distance"
          value={`${Number(ride.distanceKm ?? 0).toFixed(1)} km`}
        />
        <Detail label="Fare" value={formatPeso(ride.total ?? 0)} />
        <Detail
          label="On-chain value"
          value={`${Number(ride.fareSats ?? 0).toLocaleString()} sats`}
        />
        <Detail
          label="PHP estimate"
          value={formatPeso(
            satoshisToCentavos(Number(ride.fareSats ?? 0), fareConfig),
          )}
        />
        <Detail label="Rate version" value={ride.config?.version ?? "—"} />
        <Detail label="Payment" value={ride.paymentStatus ?? "—"} />
      </div>
      {txid && (
        <a
          href={`https://chipnet.chaingraph.cash/tx/${txid}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 block rounded-xl bg-pasada-blue/8 px-3 py-3 text-[11px] font-semibold text-pasada-blue hover:bg-pasada-blue/12"
        >
          Open transaction on Chipnet explorer ↗
        </a>
      )}
    </aside>
  )
}

function Detail({ label, value }: { label: string value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-[11px] text-ink-400">{label}</span>
      <span className="num text-right text-[11px] text-ink-700">{value}</span>
    </div>
  )
}

function RideStatus({ status }: { status: string }) {
  const tone =
    status === "settled"
      ? "blue"
      : status === "cancelled"
        ? "red"
        : activeRideStatuses.includes(status)
          ? "ink"
          : "muted"
  return <Pill tone={tone}>{status.replaceAll("_", " ")}</Pill>
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 font-display text-[11px] font-bold capitalize transition-colors ${
        active ? "bg-ink text-white" : "bg-white text-ink-500 hover:text-ink"
      }`}
    >
      {children}
    </button>
  )
}

function Users({ users }: { users: AdminManagedUser[] }) {
  const [filter, setFilter] = useState<"all" | "driver" | "passenger">("all")
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState("")
  const shown = users.filter(
    (user) =>
      (filter === "all" || user.kind === filter) &&
      `${user.name} ${user.email} ${user.bchAddress}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )
  const changeState = async (
    user: AdminManagedUser,
    state: ManagedUser["state"],
  ) => {
    setBusy(user.id)
    setMessage("")
    try {
      await setAdminUserState(user, state)
      setMessage(`${user.name} is now ${state}.`)
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Account status could not be updated.",
      )
    } finally {
      setBusy("")
    }
  }
  const stateTone = {
    active: "blue",
    pending: "muted",
    suspended: "red",
    rejected: "outline",
  } as const
  return (
    <>
      <Header
        title="User management"
        sub="Live passenger and driver profiles. Account actions are written to Firebase and enforced on the next app login."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5">
          {(["all", "driver", "passenger"] as const).map((item) => (
            <FilterButton
              key={item}
              active={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </FilterButton>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, email, or address"
          className="w-full rounded-xl bg-white px-3.5 py-2.5 text-[11px] outline-none ring-1 ring-ink-100 focus:ring-ink sm:max-w-[280px]"
        />
      </div>
      {message && (
        <p
          className={`mb-3 rounded-xl px-3 py-2.5 text-[11px] ${
            message.includes("could not") || message.includes("active ride")
              ? "bg-pasada-red/10 text-pasada-red"
              : "bg-pasada-blue/10 text-pasada-blue"
          }`}
        >
          {message}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl bg-white">
        <table className="w-full min-w-[850px] text-left">
          <thead>
            <tr className="border-b border-ink-100 font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">BCH wallet</th>
              <th className="px-4 py-3 text-right font-medium">Trips</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {shown.map((user) => (
              <tr
                key={`${user.kind}_${user.id}`}
                className="transition-colors hover:bg-ink-50"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-full font-display text-[11px] font-bold text-white ${
                        user.kind === "driver"
                          ? "bg-pasada-red"
                          : "bg-pasada-blue"
                      }`}
                    >
                      {initials(user.name)}
                    </span>
                    <div>
                      <p className="font-display text-[12px] font-bold">
                        {user.name}
                      </p>
                      <p className="text-[10px] text-ink-300">
                        {user.email || user.vehicle || `Joined ${user.joined}`}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[11px] capitalize text-ink-500">
                    {user.kind}
                  </span>
                  {user.online && (
                    <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-[#0AC18E]" />
                  )}
                </td>
                <td className="max-w-[170px] px-4 py-3">
                  <Txid value={user.bchAddress || "unavailable"} />
                </td>
                <td className="num px-4 py-3 text-right text-[11px]">
                  {user.trips}
                </td>
                <td className="px-4 py-3">
                  <Pill tone={stateTone[user.state]}>{user.state}</Pill>
                  {user.activeRideId && (
                    <p className="mt-1 text-[8px] text-pasada-red">
                      Active ride
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    {user.state === "active" ? (
                      <MiniButton
                        tone="red"
                        disabled={
                          busy === user.id || Boolean(user.activeRideId)
                        }
                        onClick={() => void changeState(user, "suspended")}
                      >
                        Suspend
                      </MiniButton>
                    ) : (
                      <>
                        <MiniButton
                          tone="blue"
                          disabled={busy === user.id}
                          onClick={() => void changeState(user, "active")}
                        >
                          Activate
                        </MiniButton>
                        {user.state === "pending" && (
                          <MiniButton
                            tone="red"
                            disabled={
                              busy === user.id || Boolean(user.activeRideId)
                            }
                            onClick={() => void changeState(user, "rejected")}
                          >
                            Reject
                          </MiniButton>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[12px] text-ink-300"
                >
                  No accounts match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function MiniButton({
  children,
  onClick,
  tone,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  tone: "blue" | "red"
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1.5 font-display text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        tone === "blue"
          ? "bg-pasada-blue/10 text-pasada-blue-deep hover:bg-pasada-blue hover:text-white"
          : "bg-pasada-red/10 text-pasada-red-deep hover:bg-pasada-red hover:text-white"
      }`}
    >
      {children}
    </button>
  )
}

function FareSection({
  fareConfig,
  setFareConfig,
}: {
  fareConfig: FareConfig
  setFareConfig: (config: FareConfig) => Promise<void>
}) {
  const [draft, setDraft] = useState(fareConfig)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<FareHistoryEntry[]>([])
  const [previewKm, setPreviewKm] = useState(3.2)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState("")

  const initInputs = (config: FareConfig) => ({
    seatCapacity: String(config.seatCapacity),
    baseDistanceKm: String(config.baseDistanceKm),
    baseFarePerSeat: (config.baseFarePerSeat / PESO).toString(),
    additionalFarePerKmPerSeat: (
      config.additionalFarePerKmPerSeat / PESO
    ).toString(),
    pasadaUpfrontFee: (config.pasadaUpfrontFee / PESO).toString(),
    specialTripFee: (config.specialTripFee / PESO).toString(),
    nightFeeWithinBase: (config.nightFeeWithinBase / PESO).toString(),
    nightFeeBeyondBase: (config.nightFeeBeyondBase / PESO).toString(),
    platformTaxBps: (config.platformTaxBps / 100).toString(),
    phpPerBchCentavos: (config.phpPerBchCentavos / PESO).toString(),
    nightStartHour: String(config.nightStartHour),
    nightEndHour: String(config.nightEndHour),
    discountPercent: String(config.discountPercent),
    maxDiscountedSeats: String(config.maxDiscountedSeats),
  })

  useEffect(() => {
    setDraft(fareConfig)
    setInputs(initInputs(fareConfig))
  }, [fareConfig])

  useEffect(() => subscribeFareHistory(setHistory), [])

  const updateField = (
    key: keyof FareConfig,
    text: string,
    toConfigValue: (str: string) => number,
  ) => {
    setInputs((prev) => ({ ...prev, [key]: text }))
    setDraft((prev) => ({ ...prev, [key]: toConfigValue(text) }) as FareConfig)
  }

  const preview = useMemo(
    () =>
      calculateFare(draft, {
        tripDistanceKm: previewKm,
        passengers: 2,
        discountedSeats: 0,
        specialTrip: false,
        nightTrip: isNightHour(draft),
      }),
    [draft, previewKm],
  )
  const dirty = JSON.stringify(draft) !== JSON.stringify(fareConfig)

  const money = (key: keyof FareConfig, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <TextInput
        mono
        value={inputs[key] ?? (Number(draft[key]) / PESO).toString()}
        onChange={(val) =>
          updateField(key, val, (v) =>
            Math.max(0, Math.round((Number(v) || 0) * PESO)),
          )
        }
      />
    </Field>
  )

  const publish = async () => {
    setPublishing(true)
    setMessage("")
    try {
      validateFareConfig(draft)
      const currentVersion = Number(fareConfig.version.match(/\d+/)?.[0] ?? 0)
      const next = {
        ...draft,
        version: `v${currentVersion + 1}`,
        effective: new Date().toISOString().slice(0, 10),
      }
      await setFareConfig(next)
      setMessage(
        `${next.version} published. Passenger and driver apps are updating live.`,
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Fare configuration could not be published.",
      )
    } finally {
      setPublishing(false)
    }
  }

  return (
    <>
      <Header
        title="Fare configuration"
        sub="Publish one versioned fare model to Firebase. Passenger quotes and driver payouts receive it immediately; active rides keep their original snapshot."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_350px]">
        <div className="space-y-5">
          <Panel title="Capacity & distance">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Minimum buyout (seats)"
                hint="Riders at or below this number are billed at the minimum; additional riders are added one-for-one."
              >
                <TextInput
                  mono
                  value={inputs.seatCapacity ?? String(draft.seatCapacity)}
                  onChange={(val) =>
                    updateField("seatCapacity", val, (v) =>
                      Math.max(1, parseInt(v, 10) || 1),
                    )
                  }
                />
              </Field>
              <Field
                label="Base distance (km)"
                hint="Measured from passenger pickup."
              >
                <TextInput
                  mono
                  value={inputs.baseDistanceKm ?? String(draft.baseDistanceKm)}
                  onChange={(val) =>
                    updateField("baseDistanceKm", val, (v) => Number(v) || 0)
                  }
                />
              </Field>
            </div>
          </Panel>
          <Panel title="Published rates">
            <div className="grid gap-4 sm:grid-cols-2">
              {money("baseFarePerSeat", "Base fare per seat")}
              {money(
                "additionalFarePerKmPerSeat",
                "Additional per km per seat",
              )}
              {money("pasadaUpfrontFee", "PASADA upfront fee")}
              {money("specialTripFee", "Special-trip surcharge")}
              <Field label="Platform tax (%)">
                <TextInput
                  mono
                  value={
                    inputs.platformTaxBps ??
                    (draft.platformTaxBps / 100).toString()
                  }
                  onChange={(val) =>
                    updateField("platformTaxBps", val, (v) =>
                      Math.max(0, Math.round((Number(v) || 0) * 100)),
                    )
                  }
                />
              </Field>
              <Field label="PHP per BCH">
                <TextInput
                  mono
                  value={
                    inputs.phpPerBchCentavos ??
                    (draft.phpPerBchCentavos / PESO).toString()
                  }
                  onChange={(val) =>
                    updateField("phpPerBchCentavos", val, (v) =>
                      Math.max(0, Math.round((Number(v) || 0) * PESO)),
                    )
                  }
                />
              </Field>
            </div>
          </Panel>
          <Panel title="Night trips">
            <div className="grid gap-4 sm:grid-cols-2">
              {money("nightFeeWithinBase", "Night fee within base")}
              {money("nightFeeBeyondBase", "Night fee beyond base")}
              <Field label="Start hour (24h)">
                <TextInput
                  mono
                  value={inputs.nightStartHour ?? String(draft.nightStartHour)}
                  onChange={(val) =>
                    updateField(
                      "nightStartHour",
                      val,
                      (v) => parseInt(v, 10) || 0,
                    )
                  }
                />
              </Field>
              <Field label="End hour (24h)">
                <TextInput
                  mono
                  value={inputs.nightEndHour ?? String(draft.nightEndHour)}
                  onChange={(val) =>
                    updateField(
                      "nightEndHour",
                      val,
                      (v) => parseInt(v, 10) || 0,
                    )
                  }
                />
              </Field>
            </div>
          </Panel>
          <Panel title="Discounts">
            <Toggle
              on={draft.discountsEnabled}
              onChange={(value) =>
                setDraft({ ...draft, discountsEnabled: value })
              }
              label="Enable senior / PWD / student discounts"
            />
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Discount percent">
                <TextInput
                  mono
                  value={
                    inputs.discountPercent ?? String(draft.discountPercent)
                  }
                  onChange={(val) =>
                    updateField("discountPercent", val, (v) => Number(v) || 0)
                  }
                />
              </Field>
              <Field label="Maximum discounted seats">
                <TextInput
                  mono
                  value={
                    inputs.maxDiscountedSeats ??
                    String(draft.maxDiscountedSeats)
                  }
                  onChange={(val) =>
                    updateField(
                      "maxDiscountedSeats",
                      val,
                      (v) => parseInt(v, 10) || 0,
                    )
                  }
                />
              </Field>
            </div>
          </Panel>
          {message && (
            <p
              className={`rounded-xl px-3 py-2.5 text-[11px] ${
                message.includes("published")
                  ? "bg-pasada-blue/10 text-pasada-blue"
                  : "bg-pasada-red/10 text-pasada-red"
              }`}
            >
              {message}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void publish()}
              disabled={!dirty || publishing}
            >
              {publishing ? "Publishing…" : "Publish new version"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(fareConfig)
                setInputs(initInputs(fareConfig))
                setMessage("")
              }}
              disabled={!dirty || publishing}
            >
              Discard
            </Button>
            {dirty && (
              <span className="text-[11px] text-pasada-red">
                Unpublished changes · active version is {fareConfig.version}
              </span>
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-xl bg-white p-5">
            <div className="flex items-center justify-between">
              <SectionLabel>Live preview</SectionLabel>
              <span className="num text-[11px] text-ink-300">
                {previewKm.toFixed(1)} km
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={12}
              step={0.1}
              value={previewKm}
              onChange={(event) => setPreviewKm(Number(event.target.value))}
              className="mt-3 h-1 w-full appearance-none rounded-full bg-ink-100 accent-pasada-red"
            />
            <div className="mt-4">
              <FareBreakdownList breakdown={preview} method="bch" />
            </div>
          </div>
          <div className="rounded-xl bg-white p-5">
            <SectionLabel>Firebase version history</SectionLabel>
            <div className="mt-3 space-y-2.5">
              {history.slice(0, 8).map((item, index) => (
                <div
                  key={`${item.version}_${item.publishedAt}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="num text-[11px]">{item.version}</span>
                  <span className="num text-[10px] text-ink-300">
                    {formatDate(item.publishedAt || Date.parse(item.effective))}
                  </span>
                  <Pill tone={index === 0 ? "blue" : "outline"}>
                    {index === 0 ? "Active" : "Archived"}
                  </Pill>
                </div>
              ))}
              {!history.length && (
                <p className="text-[11px] text-ink-300">
                  No published history yet.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function validateFareConfig(config: FareConfig) {
  if (config.seatCapacity < 1 || config.seatCapacity > 12)
    throw new Error("Minimum buyout must be between 1 and 12 seats.")
  if (config.baseDistanceKm <= 0 || config.baseDistanceKm > 50)
    throw new Error("Base distance must be between 0 and 50 km.")
  if (config.discountPercent < 0 || config.discountPercent > 100)
    throw new Error("Discount percent must be between 0 and 100.")
  if (
    config.maxDiscountedSeats < 0 ||
    config.maxDiscountedSeats > 12
  )
    throw new Error("Maximum discounted seats must be between 0 and 12.")
  if (
    [config.nightStartHour, config.nightEndHour].some(
      (hour) => hour < 0 || hour > 23 || !Number.isInteger(hour),
    )
  )
    throw new Error("Night hours must be whole numbers from 0 to 23.")
}

function Panel({ title, children }: { title: string children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5">
      <h2 className="mb-4 font-display text-[15px] font-extrabold">{title}</h2>
      {children}
    </section>
  )
}

function CashTokenHub({
  platformAccount,
  state,
  passengers,
}: {
  platformAccount: PlatformAccount | null
  state: CashTokenHubState
  passengers: AdminManagedUser[]
}) {
  const [chain, setChain] = useState<CashTokenWalletSnapshot>({
    bchSats: 0,
    tokenBalance: 0,
    tokenUtxos: 0,
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [issuerCopied, setIssuerCopied] = useState(false)
  const [selectedPassengerId, setSelectedPassengerId] = useState("")
  const [grantAmount, setGrantAmount] = useState("1")
  const issuerAddress =
    state.config?.issuerAddress ?? platformAccount?.bchAddress ?? ""
  const walletReady = Boolean(
    issuerAddress && hasLocalPasadaWalletKey(issuerAddress),
  )
  const refreshChain = async () => {
    if (issuerAddress) {
      try {
        const snapshot = await fetchCashTokenWalletSnapshot(
          issuerAddress,
          state.config?.categoryId,
        )
        setChain(snapshot)
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not read the PRC reserve on Chipnet.",
        )
      }
    }
  }

  useEffect(() => {
    void refreshChain()
    const timer = window.setInterval(() => void refreshChain(), 15_000)
    return () => window.clearInterval(timer)
  }, [issuerAddress, state.config?.categoryId])

  const createIssuerWallet = async () => {
    setBusy(true)
    setMessage("")
    try {
      if (state.config) {
        throw new Error(
          "The PRC category already locks the issuer wallet and cannot be rotated.",
        )
      }
      const wallet = generateBchWallet()
      linkPasadaWalletSigningKey(wallet.address, wallet.privateKeyWif)
      await setPlatformBchAddress(wallet.address)
      setMessage(
        "A fresh Chipnet test issuer address and its signing key were created in this browser's local storage. Fund this new address before initializing PRC.",
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The issuer wallet could not be created.",
      )
    } finally {
      setBusy(false)
    }
  }

  const copyIssuerAddress = async () => {
    if (!issuerAddress) return
    try {
      await navigator.clipboard.writeText(issuerAddress)
      setIssuerCopied(true)
      window.setTimeout(() => setIssuerCopied(false), 1_600)
    } catch {
      setMessage(
        "Could not copy the issuer address. Select and copy it manually.",
      )
    }
  }

  const initialize = async () => {
    setBusy(true)
    setMessage("")
    try {
      if (!issuerAddress)
        throw new Error("Create a secured issuer wallet first.")
      const privateKeyWif = getLocalPasadaWalletSigningKey(issuerAddress)
      const config = await initializePrcToken({ issuerAddress, privateKeyWif })
      setMessage(
        `PRC initialized successfully. Category ${config.categoryId.slice(0, 12)}… minted ${config.totalSupply.toLocaleString()} tokens.`,
      )
      await refreshChain()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "PRC initialization failed.",
      )
    } finally {
      setBusy(false)
    }
  }

  const retryRewards = async () => {
    if (!state.config) return
    setBusy(true)
    setMessage("")
    try {
      const privateKeyWif = getLocalPasadaWalletSigningKey(
        state.config.issuerAddress,
      )
      const claims = state.rewardClaims.filter((claim) =>
        ["pending", "failed"].includes(claim.status),
      )
      for (const claim of claims) {
        await processReferralReward({
          claim,
          config: state.config,
          privateKeyWif,
        })
      }
      setMessage(
        `${claims.length} referral reward${
          claims.length === 1 ? "" : "s"
        } processed.`,
      )
      await refreshChain()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Referral rewards could not be processed.",
      )
    } finally {
      setBusy(false)
    }
  }

  const grantCouponToPassenger = async (passenger: AdminManagedUser) => {
    if (!state.config) {
      setMessage("Initialize PRC before sending real CashToken coupons.")
      return
    }
    const amount = Math.max(1, Math.trunc(Number(grantAmount) || 1))
    setBusy(true)
    setMessage("")
    try {
      const privateKeyWif = getLocalPasadaWalletSigningKey(
        state.config.issuerAddress,
      )
      const txid = await grantCouponCredit({
        config: state.config,
        privateKeyWif,
        recipientUid: passenger.id,
        recipientName: passenger.name,
        recipientTokenAddress: deriveTokenAddress(passenger.bchAddress),
        amount,
      })
      setMessage(
        `${amount} real PRC coupon${
          amount === 1 ? "" : "s"
        } sent to ${passenger.name}. Tx ${txid.slice(0, 12)}…`,
      )
      await refreshChain()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Coupon transfer could not be broadcast.",
      )
    } finally {
      setBusy(false)
    }
  }

  const grantRandomCoupon = async () => {
    const eligible = passengers.filter((passenger) =>
      Boolean(passenger.bchAddress),
    )
    if (!eligible.length) {
      setMessage(
        "No passenger with a BCH wallet is available for a coupon grant.",
      )
      return
    }
    const picked =
      eligible[crypto.getRandomValues(new Uint32Array(1))[0] % eligible.length]
    setSelectedPassengerId(picked.id)
    await grantCouponToPassenger(picked)
  }

  const sentRewards = state.activity
    .filter(
      (item) => item.type === "referral_reward" && item.status === "confirmed",
    )
    .reduce((sum, item) => sum + item.amount, 0)
  const redeemed = state.activity
    .filter(
      (item) =>
        item.type === "coupon_redemption" && item.status === "confirmed",
    )
    .reduce((sum, item) => sum + item.amount, 0)
  const pending = state.rewardClaims.filter(
    (claim) => claim.status === "pending",
  ).length
  const failed = state.rewardClaims.filter(
    (claim) => claim.status === "failed",
  ).length
  const totalSupply = state.config?.totalSupply ?? PRC_INITIAL_SUPPLY
  const reservePercent = Math.max(
    0,
    Math.min(100, (chain.tokenBalance / totalSupply) * 100),
  )
  const couponRecipients = passengers.filter(
    (passenger) =>
      passenger.state === "active" && Boolean(passenger.bchAddress),
  )
  const selectedPassenger = couponRecipients.find(
    (passenger) => passenger.id === selectedPassengerId,
  )
  const passengerDirectory = useMemo(
    () => new Map(passengers.map((passenger) => [passenger.id, passenger])),
    [passengers],
  )

  return (
    <>
      <Header
        title="CashToken Coupon Hub"
        sub="Mint, queue, assign, and redeem real PASADA Referral Credit CashTokens on BCH Chipnet."
        action={<Pill tone="blue">PRC · Chipnet</Pill>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TokenStat
          label="Admin reserve"
          value={`${chain.tokenBalance.toLocaleString()} PRC`}
          sub={`${reservePercent.toFixed(1)}% of fixed supply`}
          tone="blue"
        />
        <TokenStat
          label="Rewards sent"
          value={sentRewards.toLocaleString()}
          sub="Referral coupons issued"
        />
        <TokenStat
          label="Coupons redeemed"
          value={redeemed.toLocaleString()}
          sub={`₱${PRC_COUPON_VALUE_PHP} saved per ride`}
          tone="red"
        />
        <TokenStat
          label="Reward queue"
          value={String(pending)}
          sub={failed ? `${failed} need review` : "Awaiting admin issue"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <div className="space-y-5">
          <Panel title="Platform fee wallet & token genesis">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[9px] tracking-[0.12em] text-ink-300 uppercase">
                  Chipnet fee address
                </p>
                <p className="num mt-1 break-all text-[11px] text-pasada-blue">
                  {issuerAddress || "No secured issuer wallet"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Pill tone={walletReady ? "blue" : "red"}>
                    {walletReady
                      ? "Local signer ready"
                      : "Signing key unavailable"}
                  </Pill>
                  <span className="num text-[10px] text-ink-400">
                    {chain.bchSats.toLocaleString()} sats on-chain
                  </span>
                  {issuerAddress && !state.config && (
                    <button
                      type="button"
                      onClick={() => void copyIssuerAddress()}
                      className="rounded-md border border-ink-200 bg-white px-2 py-1 text-[9px] font-bold text-pasada-blue"
                    >
                      {issuerCopied ? "Address copied" : "Copy funding address"}
                    </button>
                  )}
                </div>
              </div>
              {!state.config && (
                <Button
                  variant="outline"
                  onClick={() => void createIssuerWallet()}
                  disabled={busy}
                >
                  {walletReady
                    ? "Create new test issuer"
                    : "Create secured issuer wallet"}
                </Button>
              )}
            </div>

            {!state.config ? (
              <div className="mt-5 rounded-xl border border-dashed border-ink-200 bg-ink-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-display text-[14px] font-bold">
                      Initialize PASADA Referral Token
                    </p>
                    <p className="mt-1 text-[11px] text-ink-500">
                      One genesis category ·{" "}
                      {PRC_INITIAL_SUPPLY.toLocaleString()} PRC fixed supply · 1
                      PRC = ₱{PRC_COUPON_VALUE_PHP}
                    </p>
                  </div>
                  <Button
                    variant="blue"
                    onClick={() => void initialize()}
                    disabled={busy || !walletReady || chain.bchSats < 15_000}
                  >
                    {busy
                      ? "Preparing genesis…"
                      : chain.bchSats < 15_000
                        ? `Fund issuer · need ${(15_000 - chain.bchSats).toLocaleString()} sats`
                        : "Initialize PRC on Chipnet"}
                  </Button>
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-ink-300">
                  Genesis creates a vout-0 setup transaction followed by the
                  CashToken mint. Keep at least 15,000 sats in this wallet for
                  token dust and miner fees. Recorded platform-fee totals are
                  not deposits into this issuer wallet.
                </p>
                {chain.bchSats < 15_000 && issuerAddress && (
                  <p className="mt-2 rounded-lg bg-pasada-blue/8 px-3 py-2 text-[10px] leading-relaxed text-ink-500">
                    This issuer needs{" "}
                    {(15_000 - chain.bchSats).toLocaleString()} more confirmed
                    sats. Use the passenger or driver wallet&apos;s Send BCH
                    action, then paste the copied issuer address.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-xl bg-ink p-4 text-white">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[9px] tracking-[0.12em] text-white/40 uppercase">
                      PRC category
                    </p>
                    <p className="num mt-1 break-all text-[11px] text-white/75">
                      {state.config.categoryId}
                    </p>
                  </div>
                  <Pill tone="blue">Initialized</Pill>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-pasada-blue"
                    style={{ width: `${reservePercent}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-white/45">
                  <span>{chain.tokenBalance.toLocaleString()} reserve</span>
                  <span>
                    {Math.max(
                      0,
                      totalSupply - chain.tokenBalance,
                    ).toLocaleString()}{" "}
                    circulating
                  </span>
                </div>
                <a
                  href={`https://chipnet.chaingraph.cash/tx/${state.config.genesisTxid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-block text-[10px] font-bold text-pasada-blue"
                >
                  Open genesis transaction ↗
                </a>
              </div>
            )}
            {message && (
              <p
                className={`mt-3 rounded-lg px-3 py-2.5 text-[11px] ${
                  /success|created|processed|sent|selected/i.test(message)
                    ? "bg-[#0AC18E]/10 text-[#087958]"
                    : "bg-pasada-red/10 text-pasada-red"
                }`}
              >
                {message}
              </p>
            )}
          </Panel>

          <Panel title="Issue real PRC coupons">
            <p className="max-w-2xl text-[11px] leading-relaxed text-ink-500">
              Each action signs and broadcasts a real Chipnet CashToken transfer
              from the PASADA reserve to the passenger&apos;s token-aware
              wallet.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_92px_auto]">
              <label className="block">
                <span className="font-mono text-[9px] tracking-[0.12em] text-ink-400 uppercase">
                  Passenger
                </span>
                <select
                  value={selectedPassengerId}
                  onChange={(event) =>
                    setSelectedPassengerId(event.target.value)
                  }
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[12px] outline-none focus:border-pasada-blue"
                >
                  <option value="">Select a passenger</option>
                  {couponRecipients.map((passenger) => (
                    <option key={passenger.id} value={passenger.id}>
                      {passenger.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[9px] tracking-[0.12em] text-ink-400 uppercase">
                  PRC amount
                </span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={grantAmount}
                  onChange={(event) => setGrantAmount(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[12px] outline-none focus:border-pasada-blue"
                />
              </label>
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => void grantRandomCoupon()}
                  disabled={busy || !state.config || !couponRecipients.length}
                >
                  Random 1 PRC
                </Button>
                <Button
                  variant="blue"
                  onClick={() =>
                    selectedPassenger &&
                    void grantCouponToPassenger(selectedPassenger)
                  }
                  disabled={busy || !state.config || !selectedPassenger}
                >
                  Send PRC
                </Button>
              </div>
            </div>
            <p className="mt-3 text-[10px] text-ink-400">
              {state.config
                ? `${chain.tokenBalance.toLocaleString()} PRC remain in the live reserve.`
                : "Initialize and fund the PRC issuer before sending coupons."}
            </p>
          </Panel>

          <Panel title="Referral reward queue">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-[11px] leading-relaxed text-ink-500">
                A valid referral code creates one entitlement as soon as a new
                passenger completes registration. Claims stay here until an
                administrator chooses to issue real PRC from the reserve.
              </p>
              <Button
                variant="outline"
                onClick={() => void retryRewards()}
                disabled={busy || !state.config || (!pending && !failed)}
              >
                {failed ? "Retry failed rewards" : "Issue queued PRC"}
              </Button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[650px] text-left">
                <thead>
                  <tr className="border-b border-ink-100 font-mono text-[9px] tracking-[0.12em] text-ink-400 uppercase">
                    <th className="py-2 pr-4 font-medium">Referrer</th>
                    <th className="px-4 py-2 font-medium">New passenger</th>
                    <th className="px-4 py-2 font-medium">Trigger</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="py-2 pl-4 font-medium">Transaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {state.rewardClaims.map((claim) => {
                    const referrer = passengerDirectory.get(claim.referrerUid)
                    const newPassenger = passengerDirectory.get(
                      claim.referredPassengerId,
                    )
                    const referrerEmail =
                      claim.referrerEmail ??
                      referrer?.email ??
                      "Email unavailable"
                    const newPassengerEmail =
                      claim.referredPassengerEmail ??
                      newPassenger?.email ??
                      "Email unavailable"
                    return (
                      <tr key={claim.id}>
                        <td className="py-3 pr-4">
                          <p className="text-[11px] font-semibold">
                            {claim.referrerName || referrer?.name || "Referrer"}
                          </p>
                          <p className="mt-0.5 max-w-[180px] truncate text-[9px] text-ink-400">
                            {referrerEmail}
                          </p>
                          <p className="num text-[9px] text-pasada-blue">
                            {claim.referrerCode}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[11px] font-semibold">
                            {claim.referredPassengerName ||
                              newPassenger?.name ||
                              "Passenger"}
                          </p>
                          <p className="mt-0.5 max-w-[180px] truncate text-[9px] text-ink-400">
                            {newPassengerEmail}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] text-ink-500">
                            Registration referral
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Pill
                            tone={
                              claim.status === "failed"
                                ? "red"
                                : claim.status === "sent"
                                  ? "blue"
                                  : "muted"
                            }
                          >
                            {claim.status}
                          </Pill>
                          {claim.error && (
                            <p className="mt-1 max-w-[180px] text-[9px] text-pasada-red">
                              {claim.error}
                            </p>
                          )}
                        </td>
                        <td className="py-3 pl-4">
                          {claim.txid ? (
                            <a
                              href={`https://chipnet.chaingraph.cash/tx/${claim.txid}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Txid value={claim.txid} />
                            </a>
                          ) : (
                            <span className="text-[10px] text-ink-300">
                              Waiting
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!state.rewardClaims.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-8 text-center text-[11px] text-ink-300"
                      >
                        No referral rewards queued yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="space-y-5">
          <div className="rounded-xl bg-gradient-to-br from-pasada-blue to-[#2447a8] p-5 text-white">
            <p className="font-mono text-[9px] tracking-[0.14em] text-white/50 uppercase">
              Coupon economics
            </p>
            <p className="mt-3 font-display text-[28px] font-black">
              1 PRC = ₱{PRC_COUPON_VALUE_PHP}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/65">
              One coupon per ride. The PRC transfer and discounted CashScript
              escrow funding are signed together in one passenger transaction.
            </p>
            <div className="mt-4 border-t border-white/15 pt-4">
              <MetricLine
                label="Fixed supply"
                value={`${totalSupply.toLocaleString()} PRC`}
                color="text-white"
              />
              <div className="mt-2">
                <MetricLine
                  label="Network"
                  value="BCH Chipnet"
                  color="text-white"
                />
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-white p-5">
            <SectionLabel>Recent token activity</SectionLabel>
            <div className="mt-3 divide-y divide-ink-100">
              {state.activity.slice(0, 8).map((item) => (
                <div key={item.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold capitalize">
                      {item.type.replaceAll("_", " ")}
                    </p>
                    <Pill
                      tone={
                        item.status === "failed"
                          ? "red"
                          : item.status === "confirmed"
                            ? "blue"
                            : "muted"
                      }
                    >
                      {item.status}
                    </Pill>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="num text-[10px] text-ink-300">
                      {formatDate(item.createdAt)}
                    </span>
                    <span className="num text-[10px]">
                      {item.amount.toLocaleString()} PRC
                    </span>
                  </div>
                  {item.txid && (
                    <a
                      href={`https://chipnet.chaingraph.cash/tx/${item.txid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block"
                    >
                      <Txid value={item.txid} />
                    </a>
                  )}
                </div>
              ))}
              {!state.activity.length && (
                <p className="py-6 text-center text-[11px] text-ink-300">
                  Token activity will appear here.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function TokenStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: "blue" | "red"
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white p-4 ring-1 ring-ink-100">
      <span
        className={`absolute inset-x-0 top-0 h-0.5 ${
          tone === "red"
            ? "bg-pasada-red"
            : tone === "blue"
              ? "bg-pasada-blue"
              : "bg-ink"
        }`}
      />
      <p className="font-mono text-[9px] tracking-[0.12em] text-ink-400 uppercase">
        {label}
      </p>
      <p className="num mt-2 text-[24px] font-medium">{value}</p>
      <p className="mt-1 text-[10px] text-ink-300">{sub}</p>
    </div>
  )
}

function ContractSection({
  fareConfig,
  platformAccount,
  metrics,
}: {
  fareConfig: FareConfig
  platformAccount: PlatformAccount | null
  metrics: PlatformMetrics
}) {
  const [commissionAddr, setCommissionAddr] = useState(
    platformFeeAddress(platformAccount),
  )
  const [addressMessage, setAddressMessage] = useState("")
  const [savingAddress, setSavingAddress] = useState(false)
  const [config, setConfig] = useState<ContractConfig>({
    network: "chipnet",
    expiryMinutes: 30,
    updatedAt: 0,
    updatedBy: "",
  })
  const [expiry, setExpiry] = useState("30")
  const [savingConfig, setSavingConfig] = useState(false)
  const [configMessage, setConfigMessage] = useState("")
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [walletBalanceError, setWalletBalanceError] = useState("")
  useEffect(
    () => setCommissionAddr(platformFeeAddress(platformAccount)),
    [platformAccount?.bchAddress, platformAccount?.feeAddress],
  )
  useEffect(
    () =>
      subscribeContractConfig((next) => {
        setConfig(next)
        setExpiry(String(next.expiryMinutes))
      }),
    [],
  )
  useEffect(() => {
    const address = platformFeeAddress(platformAccount)
    if (!address) {
      setWalletBalance(null)
      setWalletBalanceError("")
      return
    }
    let active = true
    const refresh = async () => {
      try {
        const snapshot = await fetchCashTokenWalletSnapshot(address)
        if (!active) return
        setWalletBalance(snapshot.bchSats)
        setWalletBalanceError("")
      } catch {
        if (!active) return
        setWalletBalance(null)
        setWalletBalanceError("Could not read the current Chipnet balance.")
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [platformAccount?.bchAddress, platformAccount?.feeAddress])
  const sample = calculateFare(fareConfig, {
    tripDistanceKm: 3.2,
    passengers: 2,
    discountedSeats: 0,
    specialTrip: false,
    nightTrip: false,
  })
  const { driverPayout, platformCommission } = settlementOutputs(sample)
  const saveAddress = async () => {
    setSavingAddress(true)
    setAddressMessage("")
    try {
      await setPlatformFeeAddress(commissionAddr)
      setAddressMessage("Platform Chipnet address saved.")
    } catch (error) {
      setAddressMessage(
        error instanceof Error
          ? error.message
          : "Could not save the platform address.",
      )
    } finally {
      setSavingAddress(false)
    }
  }
  const saveSettings = async () => {
    setSavingConfig(true)
    setConfigMessage("")
    try {
      await saveContractConfig({
        expiryMinutes: Number(expiry),
      })
      setConfigMessage("Refund window saved. New bookings will use it.")
    } catch (error) {
      setConfigMessage(
        error instanceof Error
          ? error.message
          : "Contract settings could not be saved.",
      )
    } finally {
      setSavingConfig(false)
    }
  }
  return (
    <>
      <Header
        title="BCH contract control"
        sub="Set the wallet that receives PASADA fees and choose how long a new ride can remain unresolved before its safe automatic refund becomes available."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Panel title="Platform fee wallet">
            <Field
              label="Chipnet fee address"
              hint="Must begin with bchtest:. Private keys are never accepted by the admin console."
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <TextInput
                    mono
                    value={commissionAddr}
                    onChange={setCommissionAddr}
                  />
                </div>
                <Button
                  variant="blue"
                  onClick={() => void saveAddress()}
                  disabled={savingAddress}
                >
                  {savingAddress ? "Saving…" : "Save address"}
                </Button>
              </div>
            </Field>
            <div className="mt-4 grid gap-px overflow-hidden rounded-xl bg-ink-100 sm:grid-cols-2">
              <div className="bg-ink-50 px-4 py-3">
                <p className="font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
                  Current wallet balance
                </p>
                <p className="num mt-1 text-lg font-medium text-pasada-blue">
                  {walletBalance === null
                    ? "Checking..."
                    : `${walletBalance.toLocaleString()} sats`}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-400">
                  Spendable BCH at this address
                </p>
              </div>
              <div className="bg-ink-50 px-4 py-3">
                <p className="font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
                  Fees earned
                </p>
                <p className="num mt-1 text-lg font-medium">
                  {metrics.totalPlatformFeeSats.toLocaleString()} sats
                </p>
                <p className="mt-0.5 text-[10px] text-ink-400">
                  From completed rides in PASADA
                </p>
              </div>
            </div>
            {walletBalanceError && (
              <p className="mt-2 text-[10px] text-pasada-red">
                {walletBalanceError}
              </p>
            )}
            {addressMessage && (
              <p
                className={`mt-2 text-[11px] ${
                  addressMessage.includes("saved")
                    ? "text-pasada-blue"
                    : "text-pasada-red"
                }`}
              >
                {addressMessage}
              </p>
            )}
          </Panel>
          <Panel title="Automatic refund safeguard">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Refund window (minutes)"
                hint="Allowed range: 5–120 minutes."
              >
                <TextInput mono value={expiry} onChange={setExpiry} />
              </Field>
            </div>
            <p className="mt-3 rounded-lg bg-pasada-blue/8 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
              This controls the on-chain refund deadline for newly accepted rides. It does not change escrows that are already funded.
            </p>
            {configMessage && (
              <p
                className={`mt-3 rounded-xl px-3 py-2.5 text-[11px] ${
                  configMessage.includes("saved")
                    ? "bg-pasada-blue/10 text-pasada-blue"
                    : "bg-pasada-red/10 text-pasada-red"
                }`}
              >
                {configMessage}
              </p>
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={() => void saveSettings()}
                disabled={savingConfig}
              >
                {savingConfig ? "Saving…" : "Save operations settings"}
              </Button>
              {config.updatedAt > 0 && (
                <span className="text-[10px] text-ink-300">
                  Last saved {formatDate(config.updatedAt)}
                </span>
              )}
            </div>
          </Panel>
          <Panel title="Network">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-ink bg-ink p-4 text-white">
                <div className="flex items-center justify-between">
                  <p className="font-display text-[13px] font-bold">
                    BCH Chipnet
                  </p>
                  <span className="rounded-full bg-[#0AC18E]/15 px-2 py-0.5 font-mono text-[8px] text-[#0AC18E]">
                    SELECTED
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-white/45">
                  Test network · active for all PASADA wallets
                </p>
              </div>
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="cursor-not-allowed rounded-xl border border-ink-100 bg-ink-100/60 p-4 text-left opacity-45"
              >
                <div className="flex items-center justify-between">
                  <p className="font-display text-[13px] font-bold text-ink-500">
                    BCH Mainnet
                  </p>
                  <span className="rounded-full bg-ink-200 px-2 py-0.5 font-mono text-[8px] text-ink-500">
                    DISABLED
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-ink-300">
                  Unavailable in this PASADA deployment
                </p>
              </button>
            </div>
          </Panel>
          <Panel title="Settlement behavior">
            <div className="divide-y divide-ink-100">
              {[
                ["Passenger funds ride", "Ride-specific CashScript UTXO"],
                [
                  "Driver completes verified ride",
                  "Driver payout + PASADA platform fee",
                ],
                [
                  "Passenger cancellation",
                  "On-chain refund when escrow is funded",
                ],
                [
                  "Duplicate settlement attempt",
                  "Rejected because the UTXO is already spent",
                ],
              ].map(([label, value]) => (
                <Detail key={label} label={label} value={value} />
              ))}
            </div>
          </Panel>
        </div>
        <aside className="space-y-4">
          <div className="rounded-xl bg-ink p-5 text-white">
            <SectionLabel>Live settlement preview</SectionLabel>
            <p className="mt-2 text-[11px] text-white/50">
              3.2 km ride · rates {fareConfig.version}
            </p>
            <div className="mt-4 space-y-3">
              {[
                ["Driver payout", driverPayout, "bg-pasada-blue"],
                ["Platform fee", platformCommission, "bg-pasada-red"],
              ].map(([label, amount, bar]) => (
                <div key={label as string}>
                  <div className="flex justify-between gap-3">
                    <span className="text-[11px] text-white/60">
                      {label as string}
                    </span>
                    <span className="num text-[11px]">
                      {formatPeso(amount as number)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className={`block h-full rounded-full ${bar}`}
                      style={{
                        width: `${(amount as number / sample.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="num mt-4 border-t border-white/10 pt-3 text-[10px] text-white/45">
              {toSatoshis(platformCommission, fareConfig).toLocaleString()} sats
              platform output
            </p>
          </div>
          <div className="rounded-xl bg-white p-5">
            <SectionLabel>Deployed covenant</SectionLabel>
            <pre className="num mt-3 overflow-x-auto rounded-lg bg-ink-50 p-3 text-[9px] leading-relaxed text-ink-700">{`contract PasadaEscrow(...) {
  function settle(sig driverSig) {
    require(checkSig(driverSig, driver));
    require(tx.outputs[0].value == driverPayout);
    require(tx.outputs[1].value == platformFee);
  }

  function refund(sig passengerSig) {
    require(checkSig(passengerSig, passenger));
    require(tx.outputs[0].value == input - releaseFee);
  }
}`}</pre>
          </div>
        </aside>
      </div>
    </>
  )
}

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  )
}

function formatDate(value: number) {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
