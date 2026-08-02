import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import FareBreakdownList, {
  BuyoutNotice,
} from "../../components/FareBreakdownList"
import BchSendCard from "../../components/BchSendCard"
import FormerRideMessages from "../../components/FormerRideMessages"
import { subscribeUnreadMessages } from "../../lib/chat-service"
import MapCanvas from "../../components/MapCanvas"
import QRCode from "../../components/QRCode"
import RideReceiptModal from "../../components/RideReceiptModal"
import { BottomNav, Icons, PhoneFrame } from "../../components/PhoneFrame"
import { Button, Pill, Row, SectionLabel, Toggle } from "../../components/ui"
import {
  calculateFare,
  formatBchFromSats,
  formatPeso,
  isNightHour,
  satoshisToCentavos,
  toSatoshis,
} from "../../lib/fare"
import { useBchPhpQuote } from "../../lib/bch-price"
import {
  ROBINSONS_PLACE_ORMOC,
  SM_CENTER_ORMOC,
  landmarkByName,
  LANDMARKS,
  roundedDistanceKm,
  resolveDrop,
  type Point,
} from "../../lib/geo"
import { ADS, ORMOC_PLACES } from "../../lib/content"
import {
  loadPasadaAccount,
  logoutPasada,
  refreshPasadaWalletBalance,
  updatePasadaProfile,
} from "../../lib/auth"
import { setChatPresence } from "../../lib/chat-service"
import { ESCROW_FUNDING_FEE_RESERVE_SATS } from "../../lib/bch-escrow"
import {
  PRC_TOKEN_DUST_SATS,
  fetchCashTokenWalletSnapshot,
  subscribeCashTokenHub,
} from "../../lib/cashtoken-service"
import {
  cancelRide,
  createRide,
  submitDriverRating,
  subscribeAccountBalance,
  subscribeRide,
  subscribeRideHistory,
} from "../../lib/ride-service"
import type {
  DiscountClass,
  CashTokenConfig,
  FareConfig,
  LiveDriver,
  LiveRide,
  PasadaAccount,
  RideStatus,
} from "../../lib/types"

const NAV = [
  { id: "home", label: "Home", icon: Icons.home },
  { id: "wallet", label: "Wallet", icon: Icons.pay },
  { id: "messages", label: "Messages", icon: Icons.messages },
  { id: "activity", label: "Activity", icon: Icons.activity },
  { id: "settings", label: "Settings", icon: Icons.settings },
]

export default function PassengerApp({
  fareConfig,
  account,
}: {
  fareConfig: FareConfig
  account: PasadaAccount
}) {
  const [tab, setTab] = useState("home")
  const [status, setStatus] = useState<RideStatus>("idle")
  const [balanceSats, setBalanceSats] = useState(account.availableSats)
  const bchPhpQuote = useBchPhpQuote(fareConfig.phpPerBchCentavos)
  const [rideId, setRideId] = useState<string | null>(null)
  const [liveRide, setLiveRide] = useState<LiveRide | null>(null)
  const [rideHistory, setRideHistory] = useState<LiveRide[]>([])
  const [serviceError, setServiceError] = useState("")
  const [walletMessage, setWalletMessage] = useState("")
  const [prcConfig, setPrcConfig] = useState<CashTokenConfig | null>(null)
  const [prcBalance, setPrcBalance] = useState(0)
  const [prcMessage, setPrcMessage] = useState(
    "PRC has not been initialized yet.",
  )
  const [usePrcCoupon, setUsePrcCoupon] = useState(false)
  const [locating, setLocating] = useState(false)
  const [profile, setProfile] = useState({
    displayName: account.displayName,
    avatarDataUrl: account.avatarDataUrl,
  })

  const [selectedReceipt, setSelectedReceipt] = useState<LiveRide | null>(null)
  const [messageRideId, setMessageRideId] = useState<string | null>(null)
  const [unreadRooms, setUnreadRooms] = useState<Record<string, boolean>>({})
  const profileAccount = useMemo(
    () => ({ ...account, ...profile }),
    [account, profile],
  )

  useEffect(() => {
    return subscribeUnreadMessages({
      role: "passenger",
      uid: account.uid,
      rides: rideHistory,
      onUnreadChange: setUnreadRooms,
    })
  }, [account.uid, rideHistory])

  const hasUnreadMessages = Object.values(unreadRooms).some(Boolean)
  const navItems = useMemo(
    () =>
      NAV.map((item) =>
        item.id === "messages" ? { ...item, badge: hasUnreadMessages } : item,
      ),
    [hasUnreadMessages],
  )

  useEffect(() => {
    document.documentElement.dataset.theme =
      localStorage.getItem("pasada_theme") === "dark" ? "dark" : "light"
  }, [])

  const [from, setFrom] = useState(ORMOC_PLACES[2])
  const [to, setTo] = useState(ORMOC_PLACES[0])
  const [dropPoint, setDropPoint] = useState<Point>(() => {
    const l = landmarkByName(ORMOC_PLACES[0])
    return { lat: l.lat, lng: l.lng }
  })

  const [pickupPoint, setPickupPoint] = useState<Point>(() => {
    const point = landmarkByName(ORMOC_PLACES[2])
    return { lat: point.lat, lng: point.lng }
  })
  const [distanceKm, setDistanceKm] = useState(() =>
    roundedDistanceKm(pickupPoint, dropPoint),
  )
  const [durationMin, setDurationMin] = useState(8)
  const [passengers, setPassengers] = useState(2)
  const [classes, setClasses] = useState<DiscountClass[]>([])
  const [specialTrip, setSpecialTrip] = useState(false)
  const [nightTrip, setNightTrip] = useState(() => isNightHour(fareConfig))

  /** Config captured at confirmation — later admin edits must not touch it. */
  const [locked, setLocked] = useState<FareConfig | null>(null)

  const activeConfig = locked ?? fareConfig
  const discountedSeats =
    classes.length > 0 ? Math.min(passengers, activeConfig.seatCapacity) : 0

  const breakdown = useMemo(
    () =>
      calculateFare(activeConfig, {
        tripDistanceKm: distanceKm,
        passengers,
        discountedSeats,
        specialTrip,
        nightTrip,
        couponDiscountPhp:
          usePrcCoupon && prcConfig ? prcConfig.couponValuePhp : 0,
      }),
    [
      activeConfig,
      distanceKm,
      passengers,
      discountedSeats,
      specialTrip,
      nightTrip,
      usePrcCoupon,
      prcConfig,
    ],
  )

  const balance = satoshisToCentavos(balanceSats, bchPhpQuote)

  const selectPickup = (name: string) => {
    setFrom(name)
    const point = landmarkByName(name)
    setPickupPoint({ lat: point.lat, lng: point.lng })
  }

  const useCurrentLocation = async () => {
    setLocating(true)
    setServiceError("")
    try {
      const point = await browserLocation()
      setPickupPoint(point)
      setFrom("Current location")
    } catch (error) {
      setServiceError(
        error instanceof Error
          ? error.message
          : "Your current location is unavailable.",
      )
    } finally {
      setLocating(false)
    }
  }

  const syncWallet = async () => {
    setWalletMessage("Checking the BCH network...")
    try {
      await refreshPasadaWalletBalance(
        "passenger",
        account.uid,
        account.bchAddress,
      )
      if (prcConfig) {
        const tokenWallet = await fetchCashTokenWalletSnapshot(
          account.bchAddress,
          prcConfig.categoryId,
        )
        setPrcBalance(tokenWallet.tokenBalance)
        setPrcMessage(`${tokenWallet.tokenBalance} PRC confirmed on Chipnet.`)
      }
      setWalletMessage("Live BCH and PRC balances refreshed from Chipnet.")
    } catch {
      setWalletMessage(
        "Could not reach the BCH balance service. Showing the last saved balance.",
      )
    }
  }

  useEffect(
    () =>
      subscribeCashTokenHub((state) => setPrcConfig(state.config), "passenger"),
    [],
  )

  useEffect(() => {
    if (!prcConfig) {
      setPrcBalance(0)
      setPrcMessage("PRC has not been initialized yet.")
      return
    }
    let active = true
    const refresh = () => {
      void fetchCashTokenWalletSnapshot(
        account.bchAddress,
        prcConfig.categoryId,
      )
        .then((snapshot) => {
          if (!active) return
          setPrcBalance(snapshot.tokenBalance)
          setPrcMessage(`${snapshot.tokenBalance} PRC confirmed on Chipnet.`)
        })
        .catch(() => {
          if (active) setPrcMessage("PRC balance is temporarily unavailable.")
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account.bchAddress, prcConfig?.categoryId])

  useEffect(() => {
    if (!locked && (!prcConfig || prcBalance < 1)) setUsePrcCoupon(false)
  }, [locked, prcBalance, prcConfig])

  // Ride simulation: searching → accepted, then the driver closes on the pickup.
  useEffect(() => {
    setBalanceSats(account.availableSats)
    const unsubscribe = subscribeAccountBalance(
      "passenger",
      account.uid,
      setBalanceSats,
    )
    const refresh = () =>
      void refreshPasadaWalletBalance(
        "passenger",
        account.uid,
        account.bchAddress,
      ).catch(() => undefined)
    // Subscribe address to Watchtower on mount so it starts indexing on-chain UTXOs
    import("../../lib/bch-wallet").then(({ subscribeAddressToWatchtower }) => {
      void subscribeAddressToWatchtower(account.bchAddress)
    })
    refresh()
    // Auto-sync every 10 seconds (same as BingoPlus deposit scanner)
    const refreshTimer = window.setInterval(refresh, 10_000)
    return () => {
      unsubscribe()
      window.clearInterval(refreshTimer)
    }
  }, [account.uid, account.bchAddress, account.availableSats])

  useEffect(
    () => subscribeRideHistory("passenger", account.uid, setRideHistory),
    [account.uid],
  )

  useEffect(() => {
    void setChatPresence("passenger", account.uid, true).catch(() => undefined)
    return () => {
      void setChatPresence("passenger", account.uid, false).catch(
        () => undefined,
      )
    }
  }, [account.uid])

  useEffect(() => {
    if (!rideId) return
    return subscribeRide("passenger", rideId, (ride) => {
      if (!ride) return
      setLiveRide(ride)
      setStatus(ride.status)
    })
  }, [rideId])

  const startRideRequest = async () => {
    setServiceError("")
    try {
      const activeSats = Math.max(account.availableSats ?? 0, balanceSats ?? 0)
      const nextRideId = await createRide({
        passenger: {
          ...profileAccount,
          availableSats: activeSats,
        },
        from,
        to,
        pickup: pickupPoint,
        destination: dropPoint,
        distanceKm,
        durationMin,
        passengers,
        discountedSeats,
        specialTrip,
        nightTrip,
        total: breakdown.total,
        transportationFare: breakdown.transportationFare,
        platformFee: breakdown.platformFee,
        platformTax: breakdown.platformTax,
        config: activeConfig,
        ...(usePrcCoupon && prcConfig
          ? {
              appliedCoupon: {
                symbol: "PRC" as const,
                categoryId: prcConfig.categoryId,
                amount: 1 as const,
                discountPhp: prcConfig.couponValuePhp,
                passengerTokenAddress: account.chipnetTokenAddress,
                redemptionTokenAddress: prcConfig.redemptionTokenAddress,
                status: "reserved" as const,
              },
            }
          : {}),
      })
      setRideId(nextRideId)
      setStatus("searching")
    } catch (error) {
      setServiceError(
        error instanceof Error
          ? error.message
          : "The booking could not be created.",
      )
      setStatus("quoting")
    }
  }

  const startDemoRide = async () => {
    const demoDistanceKm = 1.9
    const demoDurationMin = 5
    const demoBreakdown = calculateFare(fareConfig, {
      tripDistanceKm: demoDistanceKm,
      passengers: 2,
      discountedSeats: 0,
      specialTrip: false,
      nightTrip: false,
    })
    setServiceError("")
    setLocked(fareConfig)
    setFrom(SM_CENTER_ORMOC.name)
    setTo(ROBINSONS_PLACE_ORMOC.name)
    setPickupPoint({ lat: SM_CENTER_ORMOC.lat, lng: SM_CENTER_ORMOC.lng })
    setDropPoint({
      lat: ROBINSONS_PLACE_ORMOC.lat,
      lng: ROBINSONS_PLACE_ORMOC.lng,
    })
    setDistanceKm(demoDistanceKm)
    setDurationMin(demoDurationMin)
    setPassengers(2)
    setClasses([])
    setSpecialTrip(false)
    setNightTrip(false)

    try {
      const demoDriverAccount = await loadPasadaAccount("driver")
      const nextRideId = await createRide({
        passenger: profileAccount,
        from: SM_CENTER_ORMOC.name,
        to: ROBINSONS_PLACE_ORMOC.name,
        pickup: SM_CENTER_ORMOC,
        destination: ROBINSONS_PLACE_ORMOC,
        distanceKm: demoDistanceKm,
        durationMin: demoDurationMin,
        passengers: 2,
        discountedSeats: 0,
        specialTrip: false,
        nightTrip: false,
        total: demoBreakdown.total,
        transportationFare: demoBreakdown.transportationFare,
        platformFee: demoBreakdown.platformFee,
        platformTax: demoBreakdown.platformTax,
        config: fareConfig,
        demoMode: true,
        demoDriverAccount,
        demoDriver: {
          plate: demoDriverAccount.plate || "PASADA",
          body: demoDriverAccount.vehicleBody || "Registered tricycle",
          rating: demoDriverAccount.rating ?? 5,
          trips: demoDriverAccount.trips ?? 0,
        },
      })
      setRideId(nextRideId)
      setStatus("searching")
    } catch (error) {
      setServiceError(
        error instanceof Error
          ? error.message
          : "The demo ride could not start.",
      )
      setStatus("quoting")
    }
  }

  const reset = () => {
    setStatus("idle")
    setLocked(null)
    setRideId(null)
    setLiveRide(null)
    setServiceError("")
    setTab("home")
  }

  const onRide = status !== "idle" && status !== "quoting"

  return (
    <PhoneFrame chrome="PASSENGER">
      {tab === "home" && !onRide && status !== "quoting" && (
        <HomeScreen
          balanceSats={balanceSats}
          account={profileAccount}
          balance={balance}
          quoteSource={bchPhpQuote.source}
          walletMessage={walletMessage}
          onSync={() => void syncWallet()}
          onBook={() => {
            setStatus("quoting")
            void useCurrentLocation()
          }}
        />
      )}

      {status === "quoting" && (
        <BookingScreen
          from={from}
          to={to}
          setFrom={selectPickup}
          setTo={setTo}
          distanceKm={distanceKm}
          pickupPoint={pickupPoint}
          dropPoint={dropPoint}
          onDrop={(pt) => {
            const r = resolveDrop(pt)
            setDropPoint(r.point)
            setTo(r.name)
          }}
          onRoute={(nextDistanceKm, nextDurationMin) => {
            setDistanceKm(nextDistanceKm)
            setDurationMin(nextDurationMin)
          }}
          passengers={passengers}
          setPassengers={setPassengers}
          classes={classes}
          setClasses={setClasses}
          specialTrip={specialTrip}
          setSpecialTrip={setSpecialTrip}
          nightTrip={nightTrip}
          setNightTrip={setNightTrip}
          breakdown={breakdown}
          prcConfig={prcConfig}
          prcBalance={prcBalance}
          usePrcCoupon={usePrcCoupon}
          setUsePrcCoupon={setUsePrcCoupon}
          balanceSats={balanceSats}
          locating={locating}
          onCurrentLocation={() => void useCurrentLocation()}
          onDemo={() => void startDemoRide()}
          onBack={() => setStatus("idle")}
          onConfirm={() => {
            setLocked(fareConfig)
            setStatus("searching")
            void startRideRequest()
          }}
          serviceError={serviceError}
        />
      )}

      {onRide && (
        <RideScreen
          status={status}
          breakdown={breakdown}
          ride={liveRide}
          driver={liveRide?.driver ?? null}
          from={from}
          to={to}
          pickupPoint={pickupPoint}
          dropPoint={dropPoint}
          onCancel={() => {
            if (!rideId) return reset()
            void cancelRide(account.uid, rideId)
              .then(() => reset())
              .catch((error) =>
                setServiceError(
                  error instanceof Error
                    ? error.message
                    : "The BCH escrow refund failed.",
                ),
              )
          }}
          onDone={reset}
          serviceError={serviceError}
        />
      )}

      {tab === "wallet" && !onRide && status !== "quoting" && (
        <PayScreen
          balance={balance}
          balanceSats={balanceSats}
          address={account.bchAddress}
          quoteSource={bchPhpQuote.source}
          walletMessage={walletMessage}
          prcConfig={prcConfig}
          prcBalance={prcBalance}
          prcMessage={prcMessage}
          tokenAddress={account.chipnetTokenAddress}
          onSync={() => void syncWallet()}
          onSent={() => void syncWallet()}
        />
      )}
      {tab === "activity" && !onRide && status !== "quoting" && (
        <ActivityScreen
          rides={rideHistory}
          onSelectReceipt={setSelectedReceipt}
        />
      )}
      {tab === "settings" && !onRide && status !== "quoting" && (
        <SettingsScreen
          account={profileAccount}
          onProfileSaved={(nextProfile) => setProfile(nextProfile)}
        />
      )}
      {tab === "messages" && !onRide && status !== "quoting" && (
        <FormerRideMessages
          role="passenger"
          account={profileAccount}
          rides={rideHistory}
          focusedRideId={messageRideId}
        />
      )}

      {!onRide && status !== "quoting" && (
        <BottomNav items={navItems} active={tab} onSelect={setTab} />
      )}
      {selectedReceipt && (
        <RideReceiptModal
          ride={selectedReceipt}
          role="passenger"
          onClose={() => setSelectedReceipt(null)}
          onMessage={
            selectedReceipt.driverId
              ? () => {
                  setMessageRideId(selectedReceipt.id)
                  setSelectedReceipt(null)
                  setTab("messages")
                }
              : undefined
          }
        />
      )}
    </PhoneFrame>
  )
}

/* ---------------------------------------------------------------- home --- */

function HomeScreen({
  balanceSats,
  balance,
  account,
  quoteSource,
  walletMessage,
  onSync,
  onBook,
}: {
  balanceSats: number
  balance: number
  account: PasadaAccount | null
  quoteSource: "CoinGecko" | "Configured fallback"
  walletMessage: string
  onSync: () => void
  onBook: () => void
}) {
  const [ad, setAd] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setAd((a) => (a + 1) % ADS.length), 4200)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-ink-50 pt-12 pb-28">
      <header className="flex items-end justify-between px-5 pt-3 pb-5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] text-ink-300 uppercase">
            Ormoc City
          </p>
          <h1 className="mt-1 font-display text-[26px] leading-none font-extrabold">
            Asa ta, {account?.displayName.split(" ")[0] || "passenger"}?
          </h1>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-full bg-ink font-display text-sm font-bold text-white">
          {(account?.displayName || "P")
            .split(" ")
            .slice(0, 2)
            .map((part) => part[0])
            .join("")}
        </div>
      </header>

      {/* Wallet */}
      <section className="px-5">
        <div className="relative overflow-hidden rounded-2xl bg-ink p-5 text-white">
          <span className="absolute -top-16 -right-14 h-44 w-44 rounded-full bg-pasada-blue/25 blur-2xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] tracking-[0.14em] text-white/45 uppercase">
                PASADA BCH balance
              </p>
              <p className="num mt-2 text-[34px] leading-none font-medium">
                {formatPeso(balance)}
              </p>
              <p className="mt-1 text-[9px] text-white/35">
                {quoteSource === "CoinGecko"
                  ? "Live PHP estimate"
                  : "Configured PHP estimate"}
              </p>
              <p className="num mt-1.5 text-[11px] text-white/50">
                {formatBchFromSats(balanceSats)} BCH ·{" "}
                {balanceSats.toLocaleString()} sats
              </p>
            </div>
            <button
              type="button"
              onClick={onSync}
              className="rounded-xl bg-pasada-red px-4 py-2.5 font-display text-[13px] font-bold transition-colors hover:bg-pasada-red-deep"
            >
              Sync wallet
            </button>
          </div>
          <div className="relative mt-5 flex items-center justify-between border-t border-white/10 pt-3.5">
            <p className="num truncate text-[10px] text-white/40">
              {account?.bchAddress || "Connecting wallet..."}
            </p>
            <span className="ml-3 shrink-0 font-mono text-[10px] tracking-[0.1em] text-white/70 uppercase">
              PASADA wallet
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-white px-4">
          <Row
            label="Live BCH address balance"
            detail={
              walletMessage || "Balance is read from your linked BCH address."
            }
            value={`${balanceSats.toLocaleString()} sats`}
            tone="credit"
          />
        </div>
      </section>

      {/* Services */}
      <section className="mt-7 px-5">
        <SectionLabel>Book a ride</SectionLabel>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={onBook}
            className="group col-span-1 aspect-square rounded-2xl bg-white p-3 text-left ring-1 ring-ink-100 transition-all hover:-translate-y-0.5 hover:ring-ink"
          >
            <span className="text-pasada-red">{Icons.trike}</span>
            <p className="mt-3 font-display text-[13px] leading-tight font-extrabold">
              Tricycle
            </p>
            <p className="mt-0.5 text-[10px] text-ink-300">Full buyout</p>
          </button>
          {["Multicab", "Habal-habal"].map((s) => (
            <div
              key={s}
              className="col-span-1 aspect-square rounded-2xl border border-dashed border-ink-100 p-3 opacity-60"
            >
              <p className="mt-auto font-display text-[13px] leading-tight font-bold text-ink-300">
                {s}
              </p>
              <p className="mt-0.5 text-[10px] text-ink-300">Soon</p>
            </div>
          ))}
        </div>
      </section>

      {/* Ads */}
      <section className="mt-7 px-5">
        <SectionLabel>Around Ormoc</SectionLabel>
        <div className="mt-3 overflow-hidden rounded-2xl">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${ad * 100}%)` }}
          >
            {ADS.map((a) => (
              <article
                key={a.title}
                className={`w-full shrink-0 p-5 ${
                  a.accent === "red"
                    ? "bg-pasada-red text-white"
                    : a.accent === "blue"
                      ? "bg-pasada-blue text-white"
                      : "bg-white text-ink"
                }`}
              >
                <p
                  className={`font-mono text-[10px] tracking-[0.14em] uppercase ${
                    a.accent === "ink" ? "text-ink-300" : "text-white/60"
                  }`}
                >
                  {a.tag}
                </p>
                <h3 className="mt-2 font-display text-lg font-extrabold">
                  {a.title}
                </h3>
                <p
                  className={`mt-1 text-[12px] leading-relaxed ${
                    a.accent === "ink" ? "text-ink-500" : "text-white/80"
                  }`}
                >
                  {a.body}
                </p>
              </article>
            ))}
          </div>
        </div>
        <div className="mt-2.5 flex justify-center gap-1.5">
          {ADS.map((a, i) => (
            <span
              key={a.title}
              className={`h-1 rounded-full transition-all ${
                i === ad ? "w-5 bg-ink" : "w-1 bg-ink-100"
              }`}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------- booking --- */

type BookingProps = {
  from: string
  to: string
  setFrom: (v: string) => void
  setTo: (v: string) => void
  distanceKm: number
  pickupPoint: Point
  dropPoint: Point
  onDrop: (p: Point) => void
  onRoute: (distanceKm: number, durationMin: number) => void
  passengers: number
  setPassengers: (v: number) => void
  classes: DiscountClass[]
  setClasses: (v: DiscountClass[]) => void
  specialTrip: boolean
  setSpecialTrip: (v: boolean) => void
  nightTrip: boolean
  setNightTrip: (v: boolean) => void
  breakdown: ReturnType<typeof calculateFare>
  prcConfig: CashTokenConfig | null
  prcBalance: number
  usePrcCoupon: boolean
  setUsePrcCoupon: (value: boolean) => void
  balanceSats: number
  locating: boolean
  onCurrentLocation: () => void
  onDemo: () => void
  onBack: () => void
  onConfirm: () => void
  serviceError: string
}

function BookingScreen(p: BookingProps) {
  const requiredSats =
    toSatoshis(p.breakdown.total, p.breakdown.config) +
    ESCROW_FUNDING_FEE_RESERVE_SATS * 2 +
    (p.usePrcCoupon ? PRC_TOKEN_DUST_SATS : 0)
  const insufficient = p.balanceSats < requiredSats
  // While picking, the sheet collapses to a bar so the map is fully tappable.
  const [picking, setPicking] = useState(false)
  const [sheetHeight, setSheetHeight] = useState(78)
  const drag = useRef<{ startY: number startHeight: number } | null>(null)

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startY: event.clientY, startHeight: sheetHeight }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    const deltaPercent =
      ((drag.current.startY - event.clientY) / window.innerHeight) * 100
    setSheetHeight(
      Math.max(36, Math.min(90, drag.current.startHeight + deltaPercent)),
    )
  }

  const endDrag = () => {
    drag.current = null
    setSheetHeight((height) => (height < 56 ? 42 : height > 84 ? 90 : 78))
  }

  return (
    <div className="relative h-full">
      <MapCanvas
        pickup={p.pickupPoint}
        dest={p.dropPoint}
        route
        showLandmarks={picking}
        onPick={picking ? p.onDrop : undefined}
        onRoute={(metrics) =>
          p.onRoute(metrics.distanceKm, metrics.durationMin)
        }
        label={picking ? "Tap to set drop-off" : "Route preview"}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink/70 to-transparent" />

      <button
        type="button"
        onClick={() => (picking ? setPicking(false) : p.onBack())}
        className="absolute top-12 left-4 z-20 grid h-9 w-9 place-items-center rounded-full bg-white font-display text-lg shadow"
        aria-label="Back"
      >
        ←
      </button>

      {picking && (
        <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl bg-white px-5 pt-4 pb-7">
          <span className="mx-auto block h-1 w-10 rounded-full bg-ink-100" />
          <div className="mt-3 flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 bg-ink" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9px] tracking-[0.14em] text-ink-300 uppercase">
                Drop-off
              </p>
              <p className="truncate font-display text-[15px] font-bold">
                {p.to}
              </p>
            </div>
            <span className="num shrink-0 text-[13px] text-ink-500">
              {p.distanceKm.toFixed(1)} km
            </span>
          </div>
          <p className="mt-2 text-[11px] text-ink-300">
            Tap anywhere on the map to move the pin. Taps near a landmark snap
            to it.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {LANDMARKS.slice(0, 5).map((l) => (
              <button
                key={l.name}
                type="button"
                onClick={() => p.onDrop({ lat: l.lat, lng: l.lng })}
                className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                  p.to === l.name
                    ? "border-ink bg-ink text-white"
                    : "border-ink-100 text-ink-500 hover:border-ink-300"
                }`}
              >
                {l.name.replace(/^(Ormoc City |Ormoc |Brgy\. )/, "")}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <Button full onClick={() => setPicking(false)}>
              Confirm drop-off
            </Button>
          </div>
        </div>
      )}

      <div
        className={`scroll-quiet absolute inset-x-0 bottom-0 overflow-y-auto rounded-t-3xl bg-white shadow-2xl transition-[height] duration-200 ${
          picking ? "hidden" : ""
        }`}
        style={{ height: `${sheetHeight}%` }}
      >
        <div className="sticky top-0 z-10 bg-white px-5 pt-2 pb-2">
          <button
            type="button"
            aria-label="Drag booking panel"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="mx-auto block h-5 w-20 touch-none cursor-ns-resize"
          >
            <span className="mx-auto block h-1 w-10 rounded-full bg-ink-100" />
          </button>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="min-w-0 flex-1 font-display text-xl font-extrabold">
              Tricycle buyout
            </h2>
            <button
              type="button"
              onClick={p.onDemo}
              className="rounded-full bg-pasada-blue px-3 py-1.5 font-display text-[11px] font-bold text-white"
            >
              Demo
            </button>
            <button
              type="button"
              onClick={p.onBack}
              aria-label="Close booking panel"
              className="grid h-8 w-8 place-items-center rounded-full bg-ink-50 text-lg text-ink-500"
            >
              ×
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 pb-6">
          {/* Locations */}
          <div className="rounded-xl border border-ink-100">
            <LocationRow
              dot="red"
              label="Pickup"
              value={p.from}
              onChange={p.setFrom}
              onCurrentLocation={p.onCurrentLocation}
              locating={p.locating}
            />
            <div className="h-px bg-ink-100" />
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-ink-50"
            >
              <span className="h-2.5 w-2.5 shrink-0 bg-ink" />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[9px] tracking-[0.14em] text-ink-300 uppercase">
                  Drop-off
                </span>
                <span className="block truncate text-[13px] font-medium">
                  {p.to}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-ink px-2.5 py-1 font-mono text-[9px] tracking-[0.1em] text-white uppercase">
                Set on map
              </span>
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3">
            <div>
              <p className="font-mono text-[9px] tracking-[0.14em] text-ink-500 uppercase">
                Trip distance
              </p>
              <p className="mt-0.5 text-[11px] text-ink-300">
                From your pickup pin, not the City Stage
              </p>
            </div>
            <p className="num text-xl font-medium">
              {p.distanceKm.toFixed(1)} km
            </p>
          </div>

          {/* Passengers */}
          <div>
            <div className="flex items-baseline justify-between">
              <SectionLabel>Passengers boarding</SectionLabel>
              <span className="text-[10px] text-ink-300">
                Does not change the fare
              </span>
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => p.setPassengers(n)}
                  className={`num rounded-lg py-2.5 text-[13px] transition-colors ${
                    p.passengers === n
                      ? "bg-ink text-white"
                      : "bg-ink-50 text-ink-500 hover:bg-ink-100"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Discounts */}
          <div>
            <SectionLabel>Verified discount classification</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["senior", "pwd", "student"] as DiscountClass[]).map((c) => {
                const on = p.classes.includes(c)
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      p.setClasses(
                        on
                          ? p.classes.filter((x) => x !== c)
                          : [...p.classes, c],
                      )
                    }
                    className={`rounded-full border px-3.5 py-1.5 text-[12px] transition-colors ${
                      on
                        ? "border-pasada-blue bg-pasada-blue text-white"
                        : "border-ink-100 text-ink-500 hover:border-ink-300"
                    }`}
                  >
                    {c === "pwd" ? "PWD" : c[0].toUpperCase() + c.slice(1)}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-300">
              Applies only to the {p.passengers} declared seat
              {p.passengers > 1 ? "s" : ""}. The remaining seats stay at the
              regular rate.
            </p>
          </div>

          <div className="rounded-xl bg-ink-50 px-4 py-1">
            <Toggle
              on={p.specialTrip}
              onChange={p.setSpecialTrip}
              label="Special trip (off usual route / private subdivision)"
            />
            <div className="h-px bg-ink-100" />
            <Toggle
              on={p.nightTrip}
              onChange={p.setNightTrip}
              label="Night trip (9PM – 5AM)"
            />
          </div>

          {p.prcConfig && (
            <div
              className={`rounded-xl border p-4 ${
                p.usePrcCoupon
                  ? "border-pasada-blue bg-pasada-blue/6"
                  : "border-ink-100 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-pasada-blue px-2 py-0.5 font-mono text-[9px] font-bold text-white">
                      PRC
                    </span>
                    <p className="font-display text-[13px] font-bold">
                      Use 1 PRC coupon
                    </p>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
                    Save {formatPeso(p.prcConfig.couponValuePhp * 100)} on this
                    ride. You hold {p.prcBalance} PRC.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={p.prcBalance < 1}
                  aria-pressed={p.usePrcCoupon}
                  onClick={() => p.setUsePrcCoupon(!p.usePrcCoupon)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    p.usePrcCoupon ? "bg-pasada-blue" : "bg-ink-100"
                  } ${p.prcBalance < 1 ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  <span
                    className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      p.usePrcCoupon ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {p.prcBalance < 1 && (
                <p className="mt-2 text-[10px] text-ink-300">
                  Earn PRC when a new passenger registers with your referral
                  code and PASADA issues the queued coupon.
                </p>
              )}
            </div>
          )}

          {/* Payment */}
          <div>
            <SectionLabel>Payment method</SectionLabel>
            <div className="mt-2 rounded-xl border border-ink bg-ink p-3 text-white">
              <p className="font-display text-[13px] font-bold">BCH escrow</p>
              <p className="mt-0.5 text-[10px] text-white/55">
                Funded from your BCH address after an assigned driver accepts
                the booking.
              </p>
            </div>
          </div>

          <FareBreakdownList breakdown={p.breakdown} method="bch" />
          <BuyoutNotice />
          <p className="rounded-lg bg-pasada-blue/8 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
            BCH network reserve:{" "}
            {formatBchFromSats(ESCROW_FUNDING_FEE_RESERVE_SATS * 2)} BCH. One
            1,000-sat reserve is held in the contract for its release
            transaction; the other covers the funding transaction&apos;s miner
            fee and any unused amount stays in your change.
          </p>

          {insufficient && (
            <p className="text-[12px] font-medium text-pasada-red">
              Balance short by {formatBchFromSats(requiredSats - p.balanceSats)}{" "}
              BCH including the escrow network reserve.
            </p>
          )}

          {p.serviceError && (
            <p className="rounded-lg bg-pasada-red/10 px-3 py-2.5 text-[12px] text-pasada-red">
              {p.serviceError}
            </p>
          )}

          <Button full onClick={p.onConfirm} disabled={insufficient}>
            Request BCH escrow · {formatPeso(p.breakdown.total)}
          </Button>
        </div>
      </div>
    </div>
  )
}

function LocationRow({
  dot,
  label,
  value,
  onChange,
  onCurrentLocation,
  locating,
}: {
  dot: "red" | "ink"
  label: string
  value: string
  onChange: (v: string) => void
  onCurrentLocation?: () => void
  locating?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span
        className={`h-2.5 w-2.5 shrink-0 ${
          dot === "red" ? "rounded-full bg-pasada-red" : "bg-ink"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[9px] tracking-[0.14em] text-ink-300 uppercase">
          {label}
        </p>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full truncate bg-transparent text-[13px] font-medium focus:outline-none"
        >
          {value === "Current location" && <option>Current location</option>}
          {ORMOC_PLACES.map((pl) => (
            <option key={pl}>{pl}</option>
          ))}
        </select>
      </div>
      {onCurrentLocation && (
        <button
          type="button"
          onClick={onCurrentLocation}
          disabled={locating}
          className="shrink-0 rounded-full border border-pasada-blue/30 px-2.5 py-1.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-pasada-blue uppercase disabled:opacity-50"
        >
          {locating ? "Locating..." : "◎ Current"}
        </button>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- ride --- */

function RideScreen({
  status,
  breakdown,
  ride,
  driver,
  from,
  to,
  pickupPoint,
  dropPoint,
  onCancel,
  onDone,
  serviceError,
}: {
  status: RideStatus
  breakdown: ReturnType<typeof calculateFare>
  ride: LiveRide | null
  driver: DriverSummary | null
  from: string
  to: string
  pickupPoint: Point
  dropPoint: Point
  onCancel: () => void
  onDone: () => void
  serviceError: string
}) {
  const escrowFunded =
    ride?.paymentStatus === "funded" || ride?.paymentStatus === "settled"
  const progress = ride?.progress ?? 0
  const driverName = driver?.name ?? "Your driver"
  const settlementTxid = ride?.onChainTxid ?? ride?.escrow?.settlementTxid
  const fundingError =
    serviceError || ride?.fundingError || ride?.escrow?.error || ""

  return (
    <div className="relative h-full">
      <MapCanvas
        pickup={pickupPoint}
        dest={dropPoint}
        route
        driver={status !== "funding" && status !== "searching"}
        driverProgress={status === "in_transit" ? (ride?.progress ?? 0) : 0.18}
        driverPosition={ride?.driver?.location}
        label={
          status === "in_transit"
            ? "En route to destination"
            : status === "searching"
              ? "Finding a tricycle"
              : "Ormoc City"
        }
      />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink/70 to-transparent" />

      <div className="scroll-quiet absolute inset-x-0 bottom-0 max-h-[80%] overflow-y-auto rounded-t-3xl bg-white px-5 pt-3 pb-7">
        <span className="mx-auto block h-1 w-10 rounded-full bg-ink-100" />

        <div className="mt-3 flex items-center gap-2">
          <Pill tone={escrowFunded ? "blue" : "muted"}>
            {escrowFunded
              ? "Escrow funded"
              : status === "searching"
                ? "Awaiting driver"
                : "Escrow pending"}
          </Pill>
          <Pill tone="outline">Config {breakdown.config.version}</Pill>
          {ride?.demoMode && <Pill tone="red">Live Ormoc demo</Pill>}
        </div>

        {status === "funding" && (
          <>
            <h2 className="mt-3 font-display text-xl font-extrabold">
              Funding BCH escrow
            </h2>
            <p className="mt-1 text-[12px] text-ink-500">
              {ride?.paymentStatus === "funding_broadcasting"
                ? "Your passenger wallet is signing and broadcasting this ride's CashScript contract."
                : "Your passenger wallet will fund this ride's CashScript contract from this browser. Your wallet display updates after broadcast."}
            </p>
            <div className="mt-4 space-y-0 divide-y divide-ink-100 rounded-xl bg-ink-50 px-4">
              <Row
                label="Escrow contract"
                value={ride?.escrow?.contractAddress ? "Prepared" : "Preparing"}
              />
              <Row
                label="Release condition"
                value="Driver signature + fixed outputs"
              />
              <Row label="Refund condition" value="Passenger signature" />
            </div>
            {fundingError && (
              <p className="mt-3 rounded-lg bg-pasada-red/10 px-3 py-2.5 text-[12px] text-pasada-red">
                {fundingError}
              </p>
            )}
            {ride?.paymentStatus === "failed" && (
              <p className="mt-3 rounded-lg bg-pasada-blue/8 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
                Re-open the passenger app in the browser where this wallet was
                created, then ask the driver to retry BCH escrow. PASADA never
                reads a private key from Firebase.
              </p>
            )}
          </>
        )}

        {status === "searching" && (
          <>
            <h2 className="mt-3 font-display text-xl font-extrabold">
              Finding a tricycle…
            </h2>
            <p className="mt-1 text-[12px] text-ink-500">
              Broadcasting to approved drivers near {from}.
            </p>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-ink-100">
              <span className="block h-full w-1/3 animate-pulse rounded-full bg-pasada-red" />
            </div>
            <div className="mt-5">
              <Button full variant="outline" onClick={onCancel}>
                Cancel request — no BCH charged
              </Button>
            </div>
          </>
        )}

        {(status === "accepted" ||
          status === "arriving" ||
          status === "awaiting_pin") && (
          <>
            <h2 className="mt-3 font-display text-xl font-extrabold">
              {status === "awaiting_pin"
                ? "Driver has arrived"
                : `${(driverName || "Driver").split(" ")[0]} is ${
                    status === "accepted"
                      ? "reviewing your booking"
                      : `${Math.max(1, Math.ceil((ride?.distanceToPickupKm ?? 1) * 3))} min away`
                  }`}
            </h2>
            {driver && <DriverCard driver={driver} />}
            {status === "awaiting_pin" ? (
              <>
                <p className="mt-4 text-[12px] text-ink-500">
                  Give this PIN to the driver to verify the booking before the
                  ride starts.
                </p>
                <p className="num mt-2 text-center text-4xl font-medium tracking-[0.3em]">
                  {ride?.pin ?? "----"}
                </p>
                <div className="mt-4">
                  <Button
                    full
                    disabled
                    aria-label="Waiting for the driver to verify the PIN"
                  >
                    PIN verified — start ride
                  </Button>
                </div>
              </>
            ) : (
              <div className="mt-4">
                <Button full variant="ghost" onClick={onCancel}>
                  Cancel ride
                </Button>
              </div>
            )}
            <p className="mt-3 text-[11px] text-ink-300">
              You can cancel before pickup; the funded BCH escrow returns to
              your linked address.
            </p>
          </>
        )}

        {status === "in_transit" && (
          <>
            <h2 className="mt-3 font-display text-xl font-extrabold">
              On the way to {to}
            </h2>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink-100">
              <span
                className="block h-full rounded-full bg-pasada-blue transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            {driver && <DriverCard driver={driver} />}
            <div className="mt-4">
              <Button full disabled>
                {progress < 0.98
                  ? `Arriving · ${Math.round(progress * 100)}%`
                  : "Confirm arrival & release payment"}
              </Button>
            </div>
          </>
        )}

        {status === "settled" && (
          <>
            <h2 className="mt-3 font-display text-xl font-extrabold">
              Ride complete
            </h2>
            <p className="mt-1 text-[12px] text-ink-500">
              The CashScript escrow released the driver payout and PASADA fee
              on-chain.
            </p>
            <div className="mt-4 divide-y divide-ink-100 rounded-xl bg-ink-50 px-4">
              <Row
                label="Driver payout"
                value={formatPeso(breakdown.total - breakdown.platformFee)}
              />
              <Row
                label="PASADA commission"
                value={formatPeso(breakdown.platformFee)}
                tone="platform"
              />
              <Row label="Refund" value={formatPeso(0)} tone="muted" />
            </div>
            {settlementTxid ? (
              <a
                href={`https://chipnet.chaingraph.cash/tx/${settlementTxid}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center justify-between gap-3 rounded-lg text-[11px] text-pasada-blue hover:underline"
              >
                <span>View settlement on Chipnet explorer</span>
                <span className="num truncate">
                  {settlementTxid.slice(-12)}
                </span>
              </a>
            ) : (
              <p className="mt-3 text-[11px] text-ink-500">Settled on-chain</p>
            )}

            <RateDriverSection
              rideId={ride?.id ?? ""}
              driverId={ride?.driverId ?? ""}
              driverName={driverName}
              onDone={onDone}
            />

            <div className="mt-4">
              <FareBreakdownList breakdown={breakdown} method="bch" compact />
            </div>
          </>
        )}

        {status === "cancelled" && (
          <>
            <h2 className="mt-3 font-display text-xl font-extrabold">
              Ride cancelled
            </h2>
            <p className="mt-1 text-[12px] text-ink-500">
              {ride?.escrow?.fundingTxid
                ? "The driver was released and the BCH escrow refund was broadcast to your linked address."
                : "The driver was released before BCH escrow funding. No funds left your wallet."}
            </p>
            <div className="mt-4">
              <Button full onClick={onDone}>
                Back to home
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

type DriverSummary = Pick<LiveDriver, "name" | "body" | "plate" | "rating">

function DriverCard({ driver }: { driver?: DriverSummary | null }) {
  const name = driver?.name || "Driver"
  const body = driver?.body || "Tricycle"
  const plate = driver?.plate || "---"
  const rating = driver?.rating ?? 5
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-ink-100 p-3">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-pasada-red font-display font-bold text-white">
        {name
          .split(" ")
          .filter(Boolean)
          .map((n) => n[0])
          .join("") || "D"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[14px] font-bold">{name}</p>
        <p className="text-[11px] text-ink-500">{body}</p>
      </div>
      <div className="text-right">
        <p className="num text-[15px] font-medium">{plate}</p>
        <p className="num text-[11px] text-ink-300">★ {rating}</p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- other tabs ----- */

function PayScreen({
  balance,
  balanceSats,
  address,
  quoteSource,
  walletMessage,
  prcConfig,
  prcBalance,
  prcMessage,
  tokenAddress,
  onSync,
  onSent,
}: {
  balance: number
  balanceSats: number
  address: string
  quoteSource: "CoinGecko" | "Configured fallback"
  walletMessage: string
  prcConfig: CashTokenConfig | null
  prcBalance: number
  prcMessage: string
  tokenAddress: string
  onSync: () => void
  onSent: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copyAddress = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-ink-50 px-5 pt-14 pb-28">
      <h1 className="font-display text-[26px] font-extrabold">Wallet</h1>
      <div className="mt-4 rounded-2xl bg-ink p-5 text-white">
        <p className="font-mono text-[10px] tracking-[0.14em] text-white/45 uppercase">
          Available
        </p>
        <p className="num mt-2 text-3xl font-medium">{formatPeso(balance)}</p>
        <p className="mt-1 text-[9px] text-white/35">
          {quoteSource === "CoinGecko"
            ? "Live PHP estimate"
            : "Configured PHP estimate"}
        </p>
        <p className="num mt-1 text-[11px] text-white/50">
          {formatBchFromSats(balanceSats)} BCH · {balanceSats.toLocaleString()}{" "}
          sats
        </p>
        <p className="num mt-4 text-[10px] break-all text-white/40">
          {address}
        </p>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl bg-gradient-to-br from-pasada-blue to-[#2347a8] p-5 text-white shadow-lg shadow-pasada-blue/15">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] tracking-[0.15em] text-white/55 uppercase">
              PASADA Referral Credit
            </p>
            <p className="num mt-2 text-3xl font-medium">{prcBalance} PRC</p>
          </div>
          <span className="rounded-full bg-white/15 px-2.5 py-1 font-mono text-[8px] font-bold tracking-[0.1em]">
            CHIPNET TOKEN
          </span>
        </div>
        <p className="mt-2 text-[10px] text-white/65">
          {prcConfig
            ? `Each PRC saves ₱${prcConfig.couponValuePhp} on one ride.`
            : "Token launch is waiting for the PASADA administrator."}
        </p>
        <p className="num mt-3 break-all border-t border-white/15 pt-3 text-[9px] text-white/45">
          {tokenAddress}
        </p>
        <p className="mt-2 text-[9px] text-white/55">{prcMessage}</p>
      </div>
      <BchSendCard
        senderAddress={address}
        balanceSats={balanceSats}
        accent="blue"
        onSent={onSent}
      />
      {/* Scannable BCH QR Code Card */}
      {address && (
        <div className="mt-4 flex flex-col items-center rounded-3xl border border-ink-100 bg-white p-5 text-center shadow-md">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-[#0AC18E]/10 px-3 py-1 font-mono text-[11px] font-bold text-[#0AC18E]">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-[#0AC18E] text-[10px] text-white">
                ₿
              </span>
              BCH
            </span>
            <span className="rounded-full bg-ink-100 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-ink-500 uppercase">
              CHIPNET
            </span>
          </div>

          <div className="mt-4">
            <QRCode value={address} size={210} />
          </div>

          <p className="num mt-4 max-w-[260px] text-[12px] font-mono leading-relaxed break-all font-medium text-ink-700">
            {address}
          </p>

          <button
            type="button"
            onClick={() => void copyAddress()}
            className="mt-3.5 flex items-center justify-center gap-2 rounded-full border border-ink-200 bg-ink-50 px-5 py-2 font-display text-[12px] font-bold text-ink-700 transition-colors hover:bg-ink-100 active:scale-98"
          >
            {copied ? "Address copied!" : "Click to copy address"}
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSync}
          className="rounded-xl bg-white py-4 font-display text-[12px] font-bold ring-1 ring-ink-100 transition-colors hover:ring-ink"
        >
          Refresh balance
        </button>
        <button
          type="button"
          onClick={() => void copyAddress()}
          className="rounded-xl bg-white py-4 font-display text-[12px] font-bold ring-1 ring-ink-100 transition-colors hover:ring-ink"
        >
          {copied ? "Address copied" : "Copy BCH address"}
        </button>
      </div>
      <div className="mt-6">
        <SectionLabel>Linked BCH wallet status</SectionLabel>
        <div className="mt-2 rounded-xl bg-white px-4">
          <Row
            label="BCH network sync"
            detail={
              walletMessage || "Reading the balance of your linked BCH address."
            }
            value="Live"
            tone="credit"
          />
        </div>
      </div>
    </div>
  )
}

function ActivityScreen({
  rides,
  onSelectReceipt,
}: {
  rides: LiveRide[]
  onSelectReceipt: (ride: LiveRide) => void
}) {
  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-ink-50 px-5 pt-14 pb-28">
      <h1 className="font-display text-[26px] font-extrabold">Activity</h1>
      <div className="mt-4 space-y-2">
        {rides.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelectReceipt(r)}
            className="w-full rounded-xl bg-white p-4 text-left transition-transform hover:-translate-y-0.5 hover:ring-1 hover:ring-pasada-blue/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-[14px] font-bold">{r.to}</p>
                <p className="mt-0.5 truncate text-[11px] text-ink-500">
                  from {r.from}
                </p>
              </div>
              <p className="num shrink-0 text-[14px]">{formatPeso(r.total)}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Pill tone={r.status === "cancelled" ? "red" : "muted"}>
                {r.status}
              </Pill>
              <Pill tone="outline">BCH escrow</Pill>
              <Pill tone="outline">{r.distanceKm} km</Pill>
              <Pill tone="outline">rates {r.config.version}</Pill>
              {r.appliedCoupon && (
                <Pill tone="blue">
                  PRC · ₱{r.appliedCoupon.discountPhp} off
                </Pill>
              )}
              <span className="ml-auto text-[10px] text-ink-300">
                {new Date(r.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-3 text-[10px] font-bold text-pasada-blue">
              Tap to view receipt →
            </p>
          </button>
        ))}
        {rides.length === 0 && (
          <p className="rounded-xl bg-white p-4 text-[12px] text-ink-300">
            No rides yet.
          </p>
        )}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-300">
        Each receipt keeps the fare configuration version that was active when
        the booking was confirmed. Later rate changes never alter a past ride.
      </p>
    </div>
  )
}

function SettingsScreen({
  account,
  onProfileSaved,
}: {
  account: PasadaAccount
  onProfileSaved: (profile: {
    displayName: string
    avatarDataUrl?: string
  }) => void
}) {
  const [name, setName] = useState(account.displayName || "PASADA passenger")
  const [avatarDataUrl, setAvatarDataUrl] = useState(account.avatarDataUrl)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [darkMode, setDarkMode] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("pasada_theme") === "dark",
  )
  const [referralShared, setReferralShared] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(account.displayName)
    setAvatarDataUrl(account.avatarDataUrl)
  }, [account.displayName, account.avatarDataUrl])

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light"
    localStorage.setItem("pasada_theme", darkMode ? "dark" : "light")
  }, [darkMode])

  const saveProfile = async () => {
    setSaving(true)
    setMessage("")
    try {
      await updatePasadaProfile("passenger", account.uid, {
        displayName: name,
        avatarDataUrl,
      })
      onProfileSaved({ displayName: name.trim(), avatarDataUrl })
      setMessage("Profile saved. Your rider details are now up to date.")
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Profile could not be saved.",
      )
    } finally {
      setSaving(false)
    }
  }

  const chooseAvatar = (file?: File) => {
    if (!file) return
    if (file.size > 750_000) {
      setMessage("Choose an image smaller than 750 KB for the demo profile.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => setAvatarDataUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  const shareReferral = async () => {
    if (!account.referralCode) return
    const text = `Ride with PASADA and use my referral code ${account.referralCode}. Once you register, PASADA can issue me a 1 PRC ride coupon.`
    if (navigator.share) {
      await navigator
        .share({ title: "PASADA referral", text })
        .catch(() => undefined)
    } else {
      await navigator.clipboard.writeText(account.referralCode)
    }
    setReferralShared(true)
    window.setTimeout(() => setReferralShared(false), 1600)
  }

  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "P"
  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-ink-50 px-5 pt-14 pb-28">
      <h1 className="font-display text-[26px] font-extrabold">Settings</h1>
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-white p-4">
        <button
          type="button"
          onClick={() => avatarInput.current?.click()}
          className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-ink font-display font-bold text-white"
          aria-label="Choose profile photo"
        >
          {avatarDataUrl ? (
            <img
              src={avatarDataUrl}
              alt="Profile"
              className="h-full w-full object-cover"
            />
          ) : (
            initials
          )}
          <span className="absolute inset-x-0 bottom-0 bg-ink/65 py-0.5 text-center text-[8px]">
            Edit
          </span>
        </button>
        <div>
          <p className="font-display text-[15px] font-bold">{name}</p>
          <p className="text-[11px] text-ink-500">
            Authenticated PASADA passenger
          </p>
        </div>
      </div>

      <input
        ref={avatarInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => chooseAvatar(event.target.files?.[0])}
      />

      <div className="mt-3 rounded-xl bg-white p-4">
        <SectionLabel>Editable profile</SectionLabel>
        <label className="mt-3 block text-[11px] font-semibold text-ink-500">
          Display name
        </label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={50}
          className="mt-1.5 w-full rounded-xl bg-ink-50 px-3 py-3 text-[13px] outline-none ring-1 ring-ink-100 focus:ring-pasada-blue"
        />
        <button
          type="button"
          onClick={() => avatarInput.current?.click()}
          className="mt-3 text-[11px] font-bold text-pasada-blue"
        >
          {avatarDataUrl ? "Change profile photo" : "Add profile photo"}
        </button>
        <div className="mt-3">
          <Button full onClick={() => void saveProfile()} disabled={saving}>
            {saving ? "Saving profile…" : "Save profile"}
          </Button>
        </div>
        {message && (
          <p
            className={`mt-2 text-[10px] ${
              message.startsWith("Profile saved")
                ? "text-[#0a9d72]"
                : "text-pasada-red"
            }`}
          >
            {message}
          </p>
        )}
      </div>

      <div className="mt-3 rounded-xl bg-white p-4">
        <SectionLabel>PASADA BCH address</SectionLabel>
        <p className="num mt-2 text-[11px] break-all text-pasada-blue">
          {account?.bchAddress || "Connecting wallet..."}
        </p>
        <p className="mt-2 text-[11px] text-ink-300">
          This public address is used to display your balance and receive BCH.{" "}
          The in-app wallet key remains in this browser only.
        </p>
      </div>

      {account.referralCode && (
        <div className="mt-3 overflow-hidden rounded-xl bg-ink p-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] tracking-[0.14em] text-white/40 uppercase">
                Your referral code
              </p>
              <p className="num mt-1 text-[20px] font-medium tracking-wide">
                {account.referralCode}
              </p>
            </div>
            <span className="rounded-full bg-pasada-blue px-2 py-1 font-mono text-[8px] font-bold">
              +1 PRC
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/50">
            When a new passenger registers with your code, PASADA places your 1
            PRC coupon entitlement in the admin issue queue.
          </p>
          <button
            type="button"
            onClick={() => void shareReferral()}
            className="mt-3 w-full rounded-lg bg-white py-2.5 font-display text-[11px] font-bold text-ink"
          >
            {referralShared ? "Referral code ready" : "Share referral code"}
          </button>
        </div>
      )}

      <div className="mt-3 rounded-xl bg-white px-4">
        <div className="flex items-center justify-between gap-4 py-3.5">
          <div>
            <p className="text-[13px] font-semibold text-ink-700">Dark mode</p>
            <p className="mt-0.5 text-[10px] text-ink-500">
              Use a low-light interface for evening trips.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDarkMode((value) => !value)}
            aria-pressed={darkMode}
            className={`relative h-7 w-12 shrink-0 overflow-hidden rounded-full transition-colors ${
              darkMode ? "bg-pasada-blue" : "bg-ink-100"
            }`}
          >
            <span
              className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-[#ffffff] shadow transition-transform ${
                darkMode ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <div className="border-t border-ink-100 py-3.5">
          <p className="text-[13px] font-semibold text-ink-700">
            Ride messages
          </p>
          <p className="mt-0.5 text-[10px] text-ink-500">
            Former drivers appear in Messages after a completed or cancelled
            ride.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Button
          full
          variant="outline"
          onClick={() => void logoutPasada("passenger")}
        >
          Log out
        </Button>
      </div>
    </div>
  )
}

function browserLocation(): Promise<Point> {
  if (!navigator.geolocation) {
    return Promise.reject(
      new Error("Location services are not supported by this browser."),
    )
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (error) =>
        reject(
          new Error(
            error.message ||
              "Allow location access to use your current pickup point.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 },
    )
  })
}

function RateDriverSection({
  rideId,
  driverId,
  driverName,
  onDone,
}: {
  rideId: string
  driverId: string
  driverName: string
  onDone: () => void
}) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const tags = [
    "Friendly driver",
    "Safe driving",
    "Clean tricycle",
    "Punctual",
    "Great service",
  ]

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (rideId && driverId) {
        await submitDriverRating(
          rideId,
          driverId,
          rating,
          comment,
          selectedTags,
        )
      }
      setSubmitted(true)
    } catch {
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="mt-4 rounded-xl bg-pasada-blue/10 p-4 text-center">
        <p className="font-display text-base font-extrabold text-pasada-blue">
          ★ Rating submitted for {driverName}!
        </p>
        <p className="mt-1 text-[12px] text-ink-500">
          Your review helps keep Ormoc PASADA safe and friendly.
        </p>
        <div className="mt-4">
          <Button full onClick={onDone}>
            Back to home
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-2xl border border-ink-100 p-4">
      <h3 className="font-display text-sm font-extrabold">
        Rate your driver ({driverName})
      </h3>
      <div className="mt-2.5 flex items-center justify-center gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            className={`text-2xl transition-transform hover:scale-110 ${
              star <= rating ? "text-amber-400" : "text-ink-200"
            }`}
          >
            ★
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggleTag(t)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              selectedTags.includes(t)
                ? "bg-pasada-blue text-white"
                : "bg-ink-100 text-ink-500 hover:bg-ink-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={`Add a comment or feedback for ${driverName}...`}
        className="mt-3 w-full rounded-xl border border-ink-100 p-3 text-[12px] focus:border-pasada-blue focus:outline-none"
        rows={2}
      />

      <div className="mt-3 flex gap-2">
        <Button
          full
          variant="blue"
          disabled={submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? "Submitting..." : "Submit rating & review"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Skip
        </Button>
      </div>
    </div>
  )
}
