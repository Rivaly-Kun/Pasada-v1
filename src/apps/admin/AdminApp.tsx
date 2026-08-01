import { useEffect, useMemo, useState } from "react"
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
  calculateFare,
  formatBchFromSats,
  formatPeso,
  PESO,
  satoshisToCentavos,
  settlementOutputs,
  toSatoshis,
} from "../../lib/fare"
import { CHAIN_TXS, MANAGED_USERS } from "../../lib/mock"
import {
  setPlatformBchAddress,
  subscribePlatformAccount,
  subscribePlatformMetrics,
  type PlatformAccount,
  type PlatformMetrics,
} from "../../lib/platform-service"
import type { FareConfig, ManagedUser } from "../../lib/types"

const SECTIONS = [
  "Dashboard",
  "Users",
  "Fare configuration",
  "Smart contract",
] as const
type Section = typeof SECTIONS[number]

export default function AdminApp({
  fareConfig,
  setFareConfig,
}: {
  fareConfig: FareConfig
  setFareConfig: (c: FareConfig) => void
}) {
  const [section, setSection] = useState<Section>("Dashboard")
  const [platformAccount, setPlatformAccount] =
    useState<PlatformAccount | null>(null)
  const [metrics, setMetrics] = useState<PlatformMetrics>({
    totalRideSats: 0,
    totalPlatformFeeSats: 0,
    totalBchFeeSats: 0,
    settledRides: 0,
    bchRides: 0,
  })

  useEffect(() => {
    const stopAccount = subscribePlatformAccount(setPlatformAccount)
    const stopMetrics = subscribePlatformMetrics(setMetrics)
    return () => {
      stopAccount()
      stopMetrics()
    }
  }, [])

  return (
    <div className="mx-auto grid min-h-[820px] w-full max-w-[1240px] grid-cols-1 overflow-hidden rounded-2xl bg-white shadow-[0_40px_90px_-40px_rgba(11,11,12,0.5)] ring-1 ring-ink/10 lg:grid-cols-[232px_1fr]">
      <aside className="flex flex-col bg-ink px-4 py-6 text-white">
        <div className="px-2">
          <p className="font-display text-lg font-black tracking-tight">
            PASADA
          </p>
          <p className="font-mono text-[9px] tracking-[0.16em] text-white/40 uppercase">
            Admin console
          </p>
        </div>
        <nav className="mt-7 space-y-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-display text-[13px] font-semibold transition-colors ${
                section === s
                  ? "bg-white text-ink"
                  : "text-white/55 hover:bg-white/8 hover:text-white"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  section === s ? "bg-pasada-red" : "bg-white/20"
                }`}
              />
              {s}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-lg bg-white/6 p-3">
          <p className="font-mono text-[9px] tracking-[0.12em] text-white/40 uppercase">
            Network
          </p>
          <p className="mt-1 font-display text-[13px] font-bold">BCH Chipnet</p>
          <p className="num mt-0.5 text-[10px] text-white/40">
            contract {fareConfig.version}
          </p>
        </div>
      </aside>

      <main className="scroll-quiet max-h-[820px] overflow-y-auto bg-ink-50 p-7">
        {section === "Dashboard" && (
          <Dashboard account={platformAccount} metrics={metrics} />
        )}
        {section === "Users" && <Users />}
        {section === "Fare configuration" && (
          <FareSection fareConfig={fareConfig} setFareConfig={setFareConfig} />
        )}
        {section === "Smart contract" && (
          <ContractSection
            fareConfig={fareConfig}
            platformAccount={platformAccount}
          />
        )}
      </main>
    </div>
  )
}

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-ink-100 pb-5">
      <div>
        <h1 className="font-display text-[30px] leading-none font-extrabold">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-ink-500">{sub}</p>
      </div>
      <Pill tone="blue">Chipnet · live</Pill>
    </header>
  )
}

/* ----------------------------------------------------------- dashboard --- */

function Dashboard({
  account,
  metrics,
}: {
  account: PlatformAccount | null
  metrics: PlatformMetrics
}) {
  return (
    <>
      <Header
        title="Operations"
        sub="Platform-wide activity across Ormoc City. Settlement figures are read from confirmed on-chain transactions."
      />

      <div className="grid grid-cols-2 gap-px bg-ink-100 lg:grid-cols-4">
        <StatTile label="Passengers" value="2,481" sub="+38 this week" />
        <StatTile
          label="Registered drivers"
          value="164"
          sub="12 online now"
          accent="blue"
        />
        <StatTile
          label="Pending applications"
          value="2"
          sub="Awaiting review"
          accent="red"
        />
        <StatTile
          label="Completed rides"
          value={String(metrics.settledRides)}
          sub="Live database total"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <section>
          <SectionLabel>Recent blockchain transactions</SectionLabel>
          <div className="mt-3 overflow-hidden rounded-xl bg-white">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-ink-100 font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Txid</th>
                  <th className="px-4 py-3 text-right font-medium">Conf</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {CHAIN_TXS.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-ink-50">
                    <td className="num px-4 py-3 text-[12px] text-ink-500">
                      {t.at}
                    </td>
                    <td className="px-4 py-3">
                      <Pill
                        tone={
                          t.kind === "refund"
                            ? "red"
                            : t.kind === "commission"
                              ? "blue"
                              : "muted"
                        }
                      >
                        {t.kind.replace("_", " ")}
                      </Pill>
                    </td>
                    <td className="px-4 py-3">
                      <Txid value={t.txid} />
                    </td>
                    <td className="num px-4 py-3 text-right text-[12px] text-ink-500">
                      {t.confirmations}
                    </td>
                    <td className="num px-4 py-3 text-right text-[12px]">
                      {formatPeso(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl bg-ink p-5 text-white">
            <p className="font-mono text-[9px] tracking-[0.14em] text-white/40 uppercase">
              Total ride transaction value
            </p>
            <p className="num mt-2 text-3xl font-medium">
              {formatPeso(satoshisToCentavos(metrics.totalRideSats, undefined))}
            </p>
            <div className="mt-4 space-y-2.5 border-t border-white/10 pt-4">
              {[
                [
                  "Platform fees collected",
                  `${metrics.totalPlatformFeeSats.toLocaleString()} sats`,
                  "text-pasada-red",
                ],
                [
                  "BCH ride fees",
                  `${metrics.totalBchFeeSats.toLocaleString()} sats`,
                  "text-pasada-blue",
                ],
              ].map(([l, v, c]) => (
                <div key={l} className="flex items-center justify-between">
                  <span className="text-[12px] text-white/55">{l}</span>
                  <span className={`num text-[13px] ${c}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-white p-5">
            <SectionLabel>Platform admin account</SectionLabel>
            <p className="mt-2 font-display text-[15px] font-bold">
              {account?.displayName ?? "Creating platform account…"}
            </p>
            <p className="num mt-1 text-[12px] text-pasada-blue">
              {metrics.totalPlatformFeeSats.toLocaleString()} sats in on-chain
              escrow receipts
            </p>
            <p className="num mt-2 break-all text-[10px] text-ink-300">
              {account?.bchAddress ?? "No platform BCH address configured yet"}
            </p>
          </div>

          <div className="rounded-xl border-l-2 border-pasada-red bg-white p-5">
            <SectionLabel>Fare model notice</SectionLabel>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-700">
              PASADA applies the fare amounts and surcharge structure of Ormoc
              City Ordinance No. 121, s. 2023, but measures the 2.5 km base
              distance from the <strong>passenger&apos;s pickup point</strong>{" "}
              rather than the Ormoc City Stage. This adaptation requires
              validation by the appropriate city transport authority.
            </p>
          </div>
        </section>
      </div>
    </>
  )
}

/* --------------------------------------------------------------- users --- */

function Users() {
  const [users, setUsers] = useState<ManagedUser[]>(MANAGED_USERS)
  const [filter, setFilter] = useState<"all" | "driver" | "passenger">("all")

  const shown = users.filter((u) => filter === "all" || u.kind === filter)
  const set = (id: string, state: ManagedUser["state"]) =>
    setUsers((us) => us.map((u) => (u.id === id ? { ...u, state } : u)))

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
        sub="Approve driver onboarding and manage account standing. Administrators can never access user private keys or move user funds."
      />

      <div className="mb-4 flex gap-1.5">
        {(["all", "driver", "passenger"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 font-display text-[12px] font-bold capitalize transition-colors ${
              filter === f
                ? "bg-ink text-white"
                : "bg-white text-ink-500 hover:text-ink"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl bg-white">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="border-b border-ink-100 font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Linked BCH address</th>
              <th className="px-4 py-3 text-right font-medium">Trips</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {shown.map((u) => (
              <tr key={u.id} className="transition-colors hover:bg-ink-50">
                <td className="px-4 py-3">
                  <p className="font-display text-[13px] font-bold">{u.name}</p>
                  <p className="num text-[10px] text-ink-300">
                    {u.vehicle ?? `joined ${u.joined}`}
                  </p>
                </td>
                <td className="px-4 py-3 text-[12px] text-ink-500 capitalize">
                  {u.kind}
                </td>
                <td className="px-4 py-3">
                  <Txid value={u.bchAddress} />
                </td>
                <td className="num px-4 py-3 text-right text-[12px]">
                  {u.trips}
                </td>
                <td className="px-4 py-3">
                  <Pill tone={stateTone[u.state]}>{u.state}</Pill>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    {u.state === "pending" ? (
                      <>
                        <MiniButton
                          onClick={() => set(u.id, "active")}
                          tone="blue"
                        >
                          Approve
                        </MiniButton>
                        <MiniButton
                          onClick={() => set(u.id, "rejected")}
                          tone="red"
                        >
                          Reject
                        </MiniButton>
                      </>
                    ) : u.state === "suspended" || u.state === "rejected" ? (
                      <MiniButton
                        onClick={() => set(u.id, "active")}
                        tone="blue"
                      >
                        Reactivate
                      </MiniButton>
                    ) : (
                      <MiniButton
                        onClick={() => set(u.id, "suspended")}
                        tone="red"
                      >
                        Suspend
                      </MiniButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
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
}: {
  children: React.ReactNode
  onClick: () => void
  tone: "blue" | "red"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 font-display text-[11px] font-bold transition-colors ${
        tone === "blue"
          ? "bg-pasada-blue/10 text-pasada-blue-deep hover:bg-pasada-blue hover:text-white"
          : "bg-pasada-red/10 text-pasada-red-deep hover:bg-pasada-red hover:text-white"
      }`}
    >
      {children}
    </button>
  )
}

/* ---------------------------------------------------------------- fare --- */

function FareSection({
  fareConfig,
  setFareConfig,
}: {
  fareConfig: FareConfig
  setFareConfig: (c: FareConfig) => void
}) {
  const [draft, setDraft] = useState<FareConfig>(fareConfig)
  const [previewKm, setPreviewKm] = useState(3.2)

  useEffect(() => setDraft(fareConfig), [fareConfig])

  const preview = useMemo(
    () =>
      calculateFare(draft, {
        tripDistanceKm: previewKm,
        passengers: 2,
        discountedSeats: 0,
        specialTrip: false,
        nightTrip: false,
      }),
    [draft, previewKm],
  )

  const dirty = JSON.stringify(draft) !== JSON.stringify(fareConfig)

  const money = (key: keyof FareConfig, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <TextInput
        mono
        value={(Number(draft[key]) / PESO).toFixed(2)}
        onChange={(v) =>
          setDraft({
            ...draft,
            [key]: Math.round((Number(v) || 0) * PESO),
          } as FareConfig)
        }
      />
    </Field>
  )

  return (
    <>
      <Header
        title="Fare configuration"
        sub="Values are versioned. A booking permanently retains the configuration that was active when the passenger confirmed it."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel title="Capacity & distance">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Fixed tricycle capacity"
                hint="Always the fare multiplier."
              >
                <TextInput
                  mono
                  value={String(draft.seatCapacity)}
                  onChange={(v) =>
                    setDraft({ ...draft, seatCapacity: Number(v) || 6 })
                  }
                />
              </Field>
              <Field
                label="Base distance (km)"
                hint="Measured from the pickup point."
              >
                <TextInput
                  mono
                  value={String(draft.baseDistanceKm)}
                  onChange={(v) =>
                    setDraft({ ...draft, baseDistanceKm: Number(v) || 2.5 })
                  }
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Rates">
            <div className="grid gap-4 sm:grid-cols-2">
              {money("baseFarePerSeat", "Base fare per seat")}
              {money(
                "additionalFarePerKmPerSeat",
                "Additional per km per seat",
                "Succeeding kilometres are rounded up.",
              )}
              {money(
                "pasadaUpfrontFee",
                "PASADA upfront fee",
                "Never folded into the driver fare.",
              )}
              <Field
                label="Platform tax (%)"
                hint="Applied to the transportation fare, then added to the visible platform fee."
              >
                <TextInput
                  mono
                  value={(draft.platformTaxBps / 100).toFixed(2)}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      platformTaxBps: Math.max(
                        0,
                        Math.round((Number(v) || 0) * 100),
                      ),
                    })
                  }
                />
              </Field>
              {money("specialTripFee", "Special-trip surcharge")}
            </div>
          </Panel>

          <Panel title="BCH conversion">
            <Field
              label="PHP per BCH"
              hint="Used to convert the published PHP tariff into whole satoshis for BCH escrow outputs."
            >
              <TextInput
                mono
                value={(draft.phpPerBchCentavos / PESO).toFixed(2)}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    phpPerBchCentavos: Math.max(
                      PESO,
                      Math.round((Number(v) || 0) * PESO),
                    ),
                  })
                }
              />
            </Field>
          </Panel>

          <Panel title="Night trips">
            <div className="grid gap-4 sm:grid-cols-2">
              {money(
                "nightFeeWithinBase",
                "Night surcharge within base distance",
              )}
              {money(
                "nightFeeBeyondBase",
                "Night surcharge beyond base distance",
              )}
              <Field label="Night start hour (24h)">
                <TextInput
                  mono
                  value={String(draft.nightStartHour)}
                  onChange={(v) =>
                    setDraft({ ...draft, nightStartHour: Number(v) || 21 })
                  }
                />
              </Field>
              <Field label="Night end hour (24h)">
                <TextInput
                  mono
                  value={String(draft.nightEndHour)}
                  onChange={(v) =>
                    setDraft({ ...draft, nightEndHour: Number(v) || 5 })
                  }
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Discounts">
            <Toggle
              on={draft.discountsEnabled}
              onChange={(v) => setDraft({ ...draft, discountsEnabled: v })}
              label="Enable senior / PWD / student discounts"
            />
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Discount percent">
                <TextInput
                  mono
                  value={String(draft.discountPercent)}
                  onChange={(v) =>
                    setDraft({ ...draft, discountPercent: Number(v) || 0 })
                  }
                />
              </Field>
              <Field
                label="Max discounted seats"
                hint="Discount applies per verified seat, not to the whole vehicle."
              >
                <TextInput
                  mono
                  value={String(draft.maxDiscountedSeats)}
                  onChange={(v) =>
                    setDraft({ ...draft, maxDiscountedSeats: Number(v) || 0 })
                  }
                />
              </Field>
            </div>
          </Panel>

          <div className="flex items-center gap-3">
            <Button
              onClick={() =>
                setFareConfig({
                  ...draft,
                  version: `v${Number(fareConfig.version.slice(1)) + 1}`,
                  effective: new Date().toISOString().slice(0, 10),
                })
              }
              disabled={!dirty}
            >
              Publish new version
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDraft(fareConfig)}
              disabled={!dirty}
            >
              Discard
            </Button>
            {dirty && (
              <span className="text-[12px] text-pasada-red">
                Unpublished changes — active rides keep {fareConfig.version}.
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
              onChange={(e) => setPreviewKm(Number(e.target.value))}
              className="mt-3 h-1 w-full appearance-none rounded-full bg-ink-100 accent-pasada-red"
            />
            <div className="mt-4">
              <FareBreakdownList breakdown={preview} method="bch" />
            </div>
          </div>

          <div className="rounded-xl bg-white p-5">
            <SectionLabel>Version history</SectionLabel>
            <div className="mt-3 space-y-2.5">
              {[
                [fareConfig.version, fareConfig.effective, true],
                ["v2", "2026-02-01", false],
                ["v1", "2025-09-15", false],
              ].map(([v, d, active]) => (
                <div
                  key={v as string}
                  className="flex items-center justify-between"
                >
                  <span className="num text-[12px]">{v as string}</span>
                  <span className="num text-[11px] text-ink-300">
                    {d as string}
                  </span>
                  {active ? (
                    <Pill tone="blue">Active</Pill>
                  ) : (
                    <Pill tone="outline">Archived</Pill>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl bg-white p-5">
      <h2 className="mb-4 font-display text-[15px] font-extrabold">{title}</h2>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------ contract --- */

function ContractSection({
  fareConfig,
  platformAccount,
}: {
  fareConfig: FareConfig
  platformAccount: PlatformAccount | null
}) {
  const [network, setNetwork] = useState<"chipnet" | "mainnet">("mainnet")
  const [commissionAddr, setCommissionAddr] = useState(
    platformAccount?.bchAddress ?? "",
  )
  const [addressMessage, setAddressMessage] = useState("")
  const [savingAddress, setSavingAddress] = useState(false)
  const [expiry, setExpiry] = useState("20")
  const [release, setRelease] = useState<"pin" | "both" | "timeout">("pin")

  useEffect(() => {
    setCommissionAddr(platformAccount?.bchAddress ?? "")
  }, [platformAccount?.bchAddress])

  const sample = calculateFare(fareConfig, {
    tripDistanceKm: 3.2,
    passengers: 2,
    discountedSeats: 0,
    specialTrip: false,
    nightTrip: false,
  })
  const { driverPayout, platformCommission } = settlementOutputs(sample)
  const savePlatformAddress = async () => {
    setSavingAddress(true)
    setAddressMessage("")
    try {
      await setPlatformBchAddress(commissionAddr)
      setAddressMessage(
        commissionAddr.trim()
          ? "Platform BCH address saved."
          : "Platform BCH address cleared.",
      )
    } catch (error) {
      setAddressMessage(
        error instanceof Error
          ? error.message
          : "Could not save the platform BCH address.",
      )
    } finally {
      setSavingAddress(false)
    }
  }

  return (
    <>
      <Header
        title="Smart contract configuration"
        sub="CashScript settlement rules. Configurations are versioned and auditable; existing rides continue on the contract that was active at booking."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Panel title="Addresses">
            <Field
              label="Platform commission address"
              hint="Optional public BCH address for the PASADA platform account."
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
                  onClick={() => void savePlatformAddress()}
                  disabled={savingAddress}
                >
                  {savingAddress ? "Saving…" : "Save address"}
                </Button>
              </div>
            </Field>
            {addressMessage && (
              <p
                className={`mt-2 text-[11px] ${
                  addressMessage.includes("saved") ||
                  addressMessage.includes("cleared")
                    ? "text-pasada-blue"
                    : "text-pasada-red"
                }`}
              >
                {addressMessage}
              </p>
            )}
            <p className="mt-3 text-[12px] text-ink-500">
              Passenger and driver payout addresses are supplied per-ride from
              each user&apos;s linked Paytaca wallet. PASADA stores addresses
              only — never keys or seed phrases.
            </p>
          </Panel>

          <Panel title="Escrow & release">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Release condition">
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ["pin", "PIN / QR verified"],
                    ["both", "Both parties confirm"],
                    ["timeout", "Timeout auto-release"],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRelease(id)}
                      className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                        release === id
                          ? "border-ink bg-ink text-white"
                          : "border-ink-100 text-ink-500 hover:border-ink-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field
                label="Ride expiration (minutes)"
                hint="Unaccepted bookings refund in full."
              >
                <TextInput mono value={expiry} onChange={setExpiry} />
              </Field>
            </div>
          </Panel>

          <Panel title="Cancellation & refund matrix">
            <div className="divide-y divide-ink-100">
              {[
                ["Cancelled before driver accepts", "Full passenger refund"],
                [
                  "Passenger cancels after acceptance",
                  "Cancellation fee retained, remainder refunded",
                ],
                ["Driver cancels", "Full passenger refund"],
                [
                  "Driver fails to arrive before expiry",
                  "Full passenger refund",
                ],
                [
                  "Ride completed & verified",
                  "Driver payout + platform commission",
                ],
                [
                  "Contract expires unresolved",
                  "Emergency refund path to passenger",
                ],
              ].map(([cond, outcome]) => (
                <div
                  key={cond}
                  className="flex items-start justify-between gap-6 py-2.5"
                >
                  <span className="text-[13px] text-ink-700">{cond}</span>
                  <span className="shrink-0 text-right text-[12px] text-ink-500">
                    {outcome}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-l-2 border-pasada-blue bg-pasada-blue/6 px-3 py-2.5 text-[11px] leading-relaxed text-ink-700">
              Duplicate release is blocked at the contract level: the escrow
              UTXO can only be spent once, so a settlement cannot be replayed.
            </p>
          </Panel>

          <Panel title="Network">
            <div className="flex gap-2">
              {(["chipnet", "mainnet"] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNetwork(n)}
                  className={`flex-1 rounded-xl border p-3 text-left transition-colors ${
                    network === n
                      ? "border-ink bg-ink text-white"
                      : "border-ink-100 hover:border-ink-300"
                  }`}
                >
                  <p className="font-display text-[13px] font-bold capitalize">
                    BCH {n}
                  </p>
                  <p
                    className={`mt-0.5 text-[10px] ${
                      network === n ? "text-white/55" : "text-ink-300"
                    }`}
                  >
                    {n === "chipnet" ? "Test network" : "Live funds"}
                  </p>
                </button>
              ))}
            </div>
            {network === "mainnet" && (
              <p className="mt-3 text-[12px] font-medium text-pasada-red">
                Mainnet moves real funds. Publishing requires a second
                administrator approval.
              </p>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl bg-ink p-5 text-white">
            <SectionLabel>Multi-output settlement</SectionLabel>
            <p className="mt-2 text-[11px] text-white/50">
              Sample: 3.2 km ride on rates {fareConfig.version}
            </p>
            <div className="mt-4 space-y-3">
              {[
                ["Output 1 · Driver payout", driverPayout, "bg-pasada-blue"],
                [
                  "Output 2 · Platform commission",
                  platformCommission,
                  "bg-pasada-red",
                ],
                ["Output 3 · Passenger refund", 0, "bg-white/25"],
              ].map(([label, amount, bar]) => (
                <div key={label as string}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/60">
                      {label as string}
                    </span>
                    <span className="num text-[12px]">
                      {formatPeso(amount as number)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className={`block h-full rounded-full ${bar as string}`}
                      style={{
                        width: `${(amount as number / sample.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="num mt-3 text-[10px] text-white/60">
              Platform tax: {formatPeso(sample.platformTax)} (
              {toSatoshis(sample.platformTax, fareConfig).toLocaleString()}{" "}
              sats)
              {" · "}total platform fee:{" "}
              {formatBchFromSats(toSatoshis(platformCommission, fareConfig))}{" "}
              BCH
            </p>
            <p className="num mt-4 border-t border-white/10 pt-3 text-[10px] text-white/40">
              Amounts denominated in satoshis on-chain — never in peso decimals.
            </p>
          </div>

          <div className="rounded-xl bg-white p-5">
            <SectionLabel>Contract source</SectionLabel>
            <pre className="num mt-3 overflow-x-auto rounded-lg bg-ink-50 p-3 text-[10px] leading-relaxed text-ink-700">
              {`contract PasadaEscrow(
  bytes20 passengerPkh,
  bytes20 driverPkh,
  bytes20 platformPkh,
  int     driverPayout,
  int     platformFee,
  int     expiry
) {
  function complete(sig s, pubkey pk) {
    require(hash160(pk) == passengerPkh);
    require(tx.outputs[0].value == driverPayout);
    require(tx.outputs[1].value == platformFee);
    require(checkSig(s, pk));
  }

  function refund(sig s, pubkey pk) {
    require(tx.time >= expiry);
    require(hash160(pk) == passengerPkh);
    require(checkSig(s, pk));
  }
}`}
            </pre>
          </div>
        </aside>
      </div>
    </>
  )
}
