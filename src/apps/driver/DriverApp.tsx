import { useEffect, useMemo, useState } from "react"
import MapCanvas from "../../components/MapCanvas"
import QRCode from "../../components/QRCode"
import { BottomNav, Icons, PhoneFrame } from "../../components/PhoneFrame"
import { Button, Pill, Row, SectionLabel } from "../../components/ui"
import WalletSigningKeyCard from "../../components/WalletSigningKeyCard"
import {
  calculateFare,
  formatBchFromSats,
  formatPeso,
  satoshisToCentavos,
  settlementOutputs,
} from "../../lib/fare"
import { useBchPhpQuote } from "../../lib/bch-price"
import { logoutPasada, refreshPasadaWalletBalance } from "../../lib/auth"
import { landmarkByName, type Point } from "../../lib/geo"
import { getScopedFirebase } from "../../lib/firebase"
import {
  acceptRide,
  cancelFundingRideByDriver,
  completeRide,
  dispatchOldestWaitingRide,
  heartbeatDriver,
  rejectRide,
  retryEscrowFunding,
  setDriverPresence,
  setRideStatus,
  subscribeAccountBalance,
  subscribeDriver,
  subscribeRide,
  subscribeRideHistory,
  updateDriverLocation,
  verifyRidePin,
} from "../../lib/ride-service"
import type {
  FareConfig,
  LiveDriver,
  LiveRide,
  PasadaAccount,
} from "../../lib/types"

const NAV = [
  { id: "home", label: "Home", icon: Icons.home },
  { id: "pay", label: "Pay", icon: Icons.pay },
  { id: "activity", label: "Activity", icon: Icons.activity },
  { id: "settings", label: "Settings", icon: Icons.settings },
]

type Stage = "idle" | "request" | "funding" | "to_pickup" | "verify" | "in_transit" | "settled"

export default function DriverApp({
  fareConfig,
  account,
}: {
  fareConfig: FareConfig
  account: PasadaAccount
}) {
  const [tab, setTab] = useState("home")
  const [online, setOnline] = useState(false)
  const [countdown, setCountdown] = useState(15)
  const [pin, setPin] = useState("")
  const [driverRecord, setDriverRecord] = useState<LiveDriver | null>(null)
  const [rideId, setRideId] = useState<string | null>(null)
  const [liveRide, setLiveRide] = useState<LiveRide | null>(null)
  const [rideHistory, setRideHistory] = useState<LiveRide[]>([])
  const [earningsSats, setEarningsSats] = useState(account.availableSats)
  const bchPhpQuote = useBchPhpQuote(fareConfig.phpPerBchCentavos)
  const [serviceError, setServiceError] = useState("")
  const [acceptingRide, setAcceptingRide] = useState(false)
  const [walletMessage, setWalletMessage] = useState("")
  const [driverLocation, setDriverLocation] = useState<Point>(() =>
    landmarkByName("Brgy. Cogon, Ormoc"),
  )

  const syncWallet = async () => {
    setWalletMessage("Checking the BCH network...")
    try {
      await refreshPasadaWalletBalance(
        "driver",
        account.uid,
        account.bchAddress,
      )
      setWalletMessage("Live BCH balance saved to PASADA Realtime Database.")
    } catch {
      setWalletMessage(
        "Could not reach the BCH balance service. Showing the last saved balance.",
      )
    }
  }

  const driver = {
    name: account.displayName,
    plate: account.plate || "Plate not set",
    body: account.vehicleBody || "Registered tricycle",
    rating: account.rating ?? 5,
    trips: account.trips ?? 0,
    bchAddress: account.bchAddress,
  }
  const request = {
    passenger: liveRide?.passengerName ?? "",
    from: liveRide?.from ?? "",
    to: liveRide?.to ?? "",
    distanceToPickupKm: liveRide?.distanceToPickupKm ?? 0,
    tripDistanceKm: liveRide?.distanceKm ?? 0.3,
    passengers: liveRide?.passengers ?? 1,
    pin: liveRide?.pin ?? "",
  }
  const needsSettlementRecovery = Boolean(
    liveRide &&
      !liveRide.demoMode &&
      liveRide.status === "settled" &&
      liveRide.escrow?.fundingTxid &&
      !liveRide.escrow.settlementTxid &&
      !liveRide.onChainTxid,
  )
  const missingEscrowContract = Boolean(
    liveRide &&
      !liveRide.demoMode &&
      liveRide.status === "completing" &&
      !liveRide.escrow,
  )
  const stage: Stage = !liveRide
    ? "idle"
    : liveRide.status === "searching"
      ? "request"
      : liveRide.status === "funding" ||
          liveRide.status === "completing" ||
          needsSettlementRecovery
        ? "funding"
        : liveRide.status === "accepted" || liveRide.status === "arriving"
          ? "to_pickup"
          : liveRide.status === "awaiting_pin"
            ? "verify"
            : liveRide.status === "in_transit"
              ? "in_transit"
              : liveRide.status === "settled"
                ? "settled"
                : "idle"
  const breakdown = useMemo(
    () =>
      calculateFare(liveRide?.config ?? fareConfig, {
        tripDistanceKm: request.tripDistanceKm,
        passengers: request.passengers,
        discountedSeats: liveRide?.discountedSeats ?? 0,
        specialTrip: liveRide?.specialTrip ?? false,
        nightTrip: liveRide?.nightTrip ?? false,
      }),
    [fareConfig, liveRide, request.passengers, request.tripDistanceKm],
  )
  const { driverPayout, platformCommission } = settlementOutputs(breakdown)
  const progress = liveRide?.progress ?? 0

  const toggleOnline = async () => {
    if (stage !== "idle") return
    setServiceError("")
    try {
      const nextLocation = online
        ? driverLocation
        : await browserLocation(driverLocation)
      setDriverLocation(nextLocation)
      await setDriverPresence(account, !online, nextLocation, {
        plate: driver.plate,
        body: driver.body,
        rating: driver.rating,
        trips: driver.trips,
      })
    } catch (error) {
      setServiceError(
        error instanceof Error
          ? error.message
          : "Driver presence could not be updated.",
      )
    }
  }

  useEffect(() => {
    setEarningsSats(account.availableSats)
    const stopBalance = subscribeAccountBalance(
      "driver",
      account.uid,
      setEarningsSats,
    )
    const refresh = () =>
      void refreshPasadaWalletBalance(
        "driver",
        account.uid,
        account.bchAddress,
      ).catch(() => undefined)
    refresh()
    const refreshTimer = window.setInterval(refresh, 10_000)
    const stopDriver = subscribeDriver(account.uid, (nextDriver) => {
      setDriverRecord(nextDriver)
      setOnline(nextDriver?.online ?? false)
      if (nextDriver?.assignedRideId) setRideId(nextDriver.assignedRideId)
    })
    return () => {
      stopDriver()
      stopBalance()
      window.clearInterval(refreshTimer)
    }
  }, [account.uid, account.bchAddress, account.availableSats])

  useEffect(
    () => subscribeRideHistory("driver", account.uid, setRideHistory),
    [account.uid],
  )

  useEffect(() => {
    if (!rideId) return
    setCountdown(15)
    return subscribeRide("driver", rideId, (ride) => {
      setLiveRide(ride)
    })
  }, [rideId])

  useEffect(() => {
    if (stage !== "request") return
    if (countdown === 0) {
      if (account && rideId) void rejectRide(account.uid, rideId)
      setRideId(null)
      setLiveRide(null)
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [stage, countdown])

  useEffect(() => {
    if (!online || liveRide?.demoMode || !navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }
        setDriverLocation(nextLocation)
        void updateDriverLocation(account.uid, nextLocation).catch((error) => {
          setServiceError(
            error instanceof Error
              ? error.message
              : "Live driver location could not be updated.",
          )
        })
      },
      (error) =>
        setServiceError(
          error.message || "Live driver location permission was lost.",
        ),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [online, account.uid, liveRide?.demoMode])

  useEffect(() => {
    if (!online || stage !== "idle") return
    const db = getScopedFirebase("driver").database
    const pollDispatch = () => {
      void heartbeatDriver(account.uid)
        .then(() => dispatchOldestWaitingRide(db))
        .catch((error) =>
          setServiceError(
            error instanceof Error
              ? error.message
              : "Driver radar could not reach Firebase.",
          ),
        )
    }
    pollDispatch()
    const timer = window.setInterval(pollDispatch, 3_000)
    return () => window.clearInterval(timer)
  }, [online, stage, account.uid])

  const reset = () => {
    setPin("")
    setRideId(null)
    setLiveRide(null)
  }

  return (
    <PhoneFrame chrome="DRIVER">
      {tab === "home" && (
        <div className="relative h-full">
          <MapCanvas
            pickup={liveRide?.pickup}
            dest={liveRide?.destination}
            route={stage !== "idle"}
            driver
            driverProgress={stage === "in_transit" ? progress : 0.12}
            driverPosition={
              stage === "request" ||
              stage === "to_pickup" ||
              stage === "verify" ||
              stage === "in_transit"
                ? (driverRecord?.location ?? driverLocation)
                : undefined
            }
            label={online ? "Online · live GPS" : "Offline"}
          />
          <div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-ink/75 to-transparent" />

          {/* Online toggle */}
          <div className="absolute top-12 right-4 left-4 z-20 flex items-center justify-between rounded-full bg-white/95 py-1.5 pr-1.5 pl-4 shadow-lg backdrop-blur">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                {online && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pasada-blue opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                    online ? "bg-pasada-blue" : "bg-ink-300"
                  }`}
                />
              </span>
              <span className="font-display text-[13px] font-bold">
                {online ? "Online · Radar active" : "Offline"}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={online}
              onClick={() => void toggleOnline()}
              disabled={stage !== "idle"}
              className={`rounded-full px-4 py-2 font-display text-[12px] font-bold transition-colors disabled:opacity-40 ${
                online ? "bg-ink-100 text-ink" : "bg-pasada-red text-white"
              }`}
            >
              {online ? "Go offline" : "Go online"}
            </button>
          </div>

          {stage === "idle" && (
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-5 pt-4 pb-28 shadow-xl">
              <span className="mx-auto block h-1 w-10 rounded-full bg-ink-100" />
              <div className="mt-3 flex items-center justify-between">
                <h2 className="font-display text-xl font-extrabold">
                  {online ? "Radar Active" : "You are offline"}
                </h2>
                {online && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-pasada-blue/10 px-2.5 py-1 text-[11px] font-semibold text-pasada-blue">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pasada-blue opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-pasada-blue" />
                    </span>
                    Scanning nearby
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-ink-500">
                {online
                  ? "Listening for nearby ride requests around your location."
                  : "Go online to receive nearby booking requests."}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-ink-100 text-center">
                {[
                  [
                    "Wallet",
                    formatPeso(satoshisToCentavos(earningsSats, bchPhpQuote)),
                  ],
                  ["Trips", String(driverRecord?.trips ?? driver.trips)],
                  ["Rating", String(driver.rating)],
                ].map(([l, v]) => (
                  <div key={l} className="bg-ink-50 py-3">
                    <p className="font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
                      {l}
                    </p>
                    <p className="num mt-1 text-[15px] font-medium">{v}</p>
                  </div>
                ))}
              </div>
              {serviceError && (
                <p className="mt-3 rounded-lg bg-pasada-red/10 px-3 py-2.5 text-[11px] text-pasada-red">
                  {serviceError}
                </p>
              )}
            </div>
          )}

          {stage === "request" && (
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-5 pt-4 pb-8">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-extrabold">
                  New booking
                </h2>
                <span className="num rounded-full bg-pasada-red px-3 py-1 text-[12px] font-medium text-white">
                  {countdown}s
                </span>
              </div>
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-ink-100">
                <span
                  className="block h-full bg-pasada-red transition-all duration-1000 ease-linear"
                  style={{ width: `${(countdown / 15) * 100}%` }}
                />
              </div>

              <div className="mt-4 space-y-1 rounded-xl border border-ink-100 p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-pasada-red" />
                  <div>
                    <p className="text-[13px] font-medium">{request.from}</p>
                    <p className="num text-[11px] text-ink-300">
                      {request.distanceToPickupKm} km away · ~
                      {Math.max(1, Math.ceil(request.distanceToPickupKm * 3))}{" "}
                      min
                    </p>
                  </div>
                </div>
                <div className="ml-1 h-4 w-px bg-ink-100" />
                <div className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 bg-ink" />
                  <div>
                    <p className="text-[13px] font-medium">{request.to}</p>
                    <p className="num text-[11px] text-ink-300">
                      {request.tripDistanceKm} km trip
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Pill tone="blue">Escrow funded</Pill>
                <Pill tone="outline">
                  {request.passengers} passengers boarding
                </Pill>
                <Pill tone="muted">6-seat buyout</Pill>
              </div>

              <div className="mt-3 divide-y divide-ink-100 rounded-xl bg-ink-50 px-4">
                <Row
                  label="Passenger pays"
                  detail="Six-seat buyout + platform fee"
                  value={formatPeso(breakdown.total)}
                />
                <Row
                  label="PASADA fee"
                  detail="Included in the passenger's BCH escrow contract."
                  value={formatPeso(platformCommission)}
                  tone="platform"
                />
                <Row
                  label="Your earnings"
                  value={formatPeso(driverPayout)}
                  strong
                />
              </div>

              <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
                <Button
                  variant="outline"
                  disabled={liveRide?.demoMode}
                  onClick={() => {
                    if (account && rideId) void rejectRide(account.uid, rideId)
                    reset()
                  }}
                >
                  Reject
                </Button>
                <Button
                  variant="red"
                  disabled={liveRide?.demoMode || acceptingRide}
                  onClick={() => {
                    if (!account || !rideId) {
                      setServiceError(
                        "This booking is no longer assigned to you. Wait for the next request.",
                      )
                      return
                    }
                    setServiceError("")
                    setAcceptingRide(true)
                    void acceptRide(account.uid, rideId)
                      .then((accepted) => {
                        if (!accepted) {
                          setServiceError(
                            "This booking is no longer available. Wait for the next request.",
                          )
                        }
                      })
                      .catch((error) =>
                        setServiceError(
                          error instanceof Error
                            ? error.message
                            : "Unable to accept this ride.",
                        ),
                      )
                      .finally(() => setAcceptingRide(false))
                  }}
                >
                  {liveRide?.demoMode
                    ? "Demo auto-accepting"
                    : acceptingRide
                      ? "Preparing BCH escrow..."
                      : `Accept · ${formatPeso(driverPayout)}`}
                </Button>
              </div>
              {serviceError && (
                <p className="mt-3 rounded-lg bg-pasada-red/10 px-3 py-2.5 text-[11px] text-pasada-red">
                  {serviceError}
                </p>
              )}
            </div>
          )}

          {stage === "funding" && (
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-5 pt-4 pb-8">
              <span className="mx-auto block h-1 w-10 rounded-full bg-ink-100" />
              <h2 className="mt-3 font-display text-xl font-extrabold">
                BCH escrow in progress
              </h2>
              <p className="mt-1 text-[12px] text-ink-500">
                {missingEscrowContract
                  ? "This ride never funded a BCH contract, so no payout can be released. Cancel this invalid ride and create a new request."
                  : needsSettlementRecovery
                    ? "This ride was recorded as complete without an on-chain payout. Retry the CashScript settlement."
                    : liveRide?.status === "completing"
                      ? "Broadcasting the contract settlement to your BCH address."
                      : liveRide?.paymentStatus === "funding_broadcasting"
                        ? "Waiting for the passenger wallet to sign and broadcast the contract."
                        : "Preparing the ride-specific CashScript contract for the passenger wallet."}
              </p>
              <div className="mt-4 divide-y divide-ink-100 rounded-xl bg-ink-50 px-4">
                <Row
                  label="Contract"
                  value={
                    missingEscrowContract
                      ? "Not funded"
                      : liveRide?.escrow?.fundingTxid
                        ? "Funded"
                        : liveRide?.escrow?.contractAddress
                          ? "Prepared"
                          : "Preparing"
                  }
                />
                <Row
                  label="Driver payout"
                  value={formatPeso(driverPayout)}
                  strong
                />
              </div>
              {(serviceError ||
                liveRide?.fundingError ||
                liveRide?.escrow?.error) && (
                <p className="mt-3 rounded-lg bg-pasada-red/10 px-3 py-2.5 text-[11px] text-pasada-red">
                  {serviceError ||
                    liveRide?.fundingError ||
                    liveRide?.escrow?.error}
                </p>
              )}
              {((liveRide?.status === "completing" &&
                Boolean(liveRide.escrow?.fundingTxid)) ||
                needsSettlementRecovery) &&
                !liveRide?.demoMode && (
                  <div className="mt-4">
                    <Button
                      full
                      variant="outline"
                      onClick={() => {
                        if (!account || !rideId) return
                        setServiceError("")
                        void completeRide(account.uid, rideId)
                          .then((settled) => {
                            if (!settled) {
                              setServiceError(
                                "The BCH settlement is not ready to retry yet.",
                              )
                            }
                          })
                          .catch((error) =>
                            setServiceError(
                              error instanceof Error
                                ? error.message
                                : "Unable to settle the BCH escrow.",
                            ),
                          )
                      }}
                    >
                      Retry BCH settlement
                    </Button>
                  </div>
                )}
              {liveRide?.status === "funding" &&
                liveRide.paymentStatus === "failed" &&
                !liveRide.demoMode && (
                  <div className="mt-4">
                    <Button
                      full
                      variant="outline"
                      onClick={() => {
                        if (!account || !rideId) return
                        setServiceError("")
                        void retryEscrowFunding(account.uid, rideId)
                          .then((funded) => {
                            if (!funded) {
                              setServiceError(
                                "The BCH escrow could not be recovered. Try again shortly.",
                              )
                              return
                            }
                          })
                          .catch((error) =>
                            setServiceError(
                              error instanceof Error
                                ? error.message
                                : "Unable to check the BCH escrow on-chain.",
                            ),
                          )
                      }}
                    >
                      Retry BCH escrow
                    </Button>
                  </div>
                )}
              {((liveRide?.status === "funding" &&
                ["funding", "failed"].includes(liveRide.paymentStatus)) ||
                missingEscrowContract) &&
                !liveRide.demoMode && (
                  <div className="mt-2">
                    <Button
                      full
                      variant="red"
                      onClick={() => {
                        if (!account || !rideId) return
                        setServiceError("")
                        void cancelFundingRideByDriver(account.uid, rideId)
                          .then((cancelled) => {
                            if (!cancelled) {
                              setServiceError(
                                "The funding transaction is already broadcasting and cannot be cancelled here.",
                              )
                              return
                            }
                            reset()
                          })
                          .catch((error) =>
                            setServiceError(
                              error instanceof Error
                                ? error.message
                                : "Unable to cancel this BCH escrow request.",
                            ),
                          )
                      }}
                    >
                      {missingEscrowContract
                        ? "Cancel invalid ride"
                        : "Cancel ride"}
                    </Button>
                  </div>
                )}
            </div>
          )}

          {stage === "to_pickup" && (
            <ActionSheet
              title={`Pick up ${request.passenger.split(" ")[0]}`}
              sub={`${request.distanceToPickupKm} km to ${request.from}`}
              payout={driverPayout}
            >
              <Button
                full
                disabled={liveRide?.demoMode}
                onClick={() => {
                  if (!account || !rideId || !liveRide) return
                  void setRideStatus(
                    account.uid,
                    rideId,
                    liveRide.status,
                    "awaiting_pin",
                  )
                }}
              >
                {liveRide?.demoMode
                  ? "Demo driver moving"
                  : "Arrived at pickup"}
              </Button>
            </ActionSheet>
          )}

          {stage === "verify" && (
            <ActionSheet
              title="Verify the passenger"
              sub="Ask for the 4-digit ride PIN before starting the ride."
              payout={driverPayout}
            >
              <div className="flex gap-2">
                <input
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  inputMode="numeric"
                  disabled={liveRide?.demoMode}
                  placeholder="––––"
                  className="num w-28 rounded-xl border border-ink-100 px-4 py-3 text-center text-lg tracking-[0.35em] focus:border-pasada-blue focus:outline-none"
                />
                <div className="flex-1">
                  <Button
                    full
                    onClick={() => {
                      if (!account || !rideId) return
                      void verifyRidePin(account.uid, rideId, pin)
                    }}
                    disabled={liveRide?.demoMode || pin !== request.pin}
                  >
                    {liveRide?.demoMode
                      ? "Demo auto-verifying"
                      : pin.length === 4 && pin !== request.pin
                        ? "PIN mismatch"
                        : "Start ride"}
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-ink-300">
                The passenger can see this ride&apos;s unique PIN in their app.
              </p>
            </ActionSheet>
          )}

          {stage === "in_transit" && (
            <ActionSheet
              title={`Heading to ${request.to}`}
              sub="Navigation active"
              payout={driverPayout}
            >
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-ink-100">
                <span
                  className="block h-full rounded-full bg-pasada-blue transition-all duration-300"
                  style={{
                    width: `${Math.max(10, Math.round(progress * 100))}%`,
                  }}
                />
              </div>
              <Button
                full
                onClick={() => {
                  if (!account || !rideId) return
                  void completeRide(account.uid, rideId).catch((error) =>
                    setServiceError(
                      error instanceof Error
                        ? error.message
                        : "The platform fee could not be settled.",
                    ),
                  )
                }}
                disabled={liveRide?.demoMode}
              >
                Mark as Arrived &amp; Complete Ride
              </Button>
              <p className="mt-2 text-center text-[11px] text-ink-400">
                Lagging GPS or arrived early? Click to complete &amp; settle.
              </p>
            </ActionSheet>
          )}

          {stage === "settled" && (
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-5 pt-4 pb-8">
              <span className="mx-auto block h-1 w-10 rounded-full bg-ink-100" />
              <h2 className="mt-3 font-display text-xl font-extrabold">
                Settled in PASADA
              </h2>
              <p className="mt-1 text-[12px] text-ink-500">
                The CashScript contract broadcast the driver payout to your BCH
                address.
              </p>
              <div className="mt-4 divide-y divide-ink-100 rounded-xl bg-ink-50 px-4">
                <Row
                  label="Driver payout"
                  detail={
                    (account?.bchAddress || driver.bchAddress).slice(0, 24) +
                    "…"
                  }
                  value={formatPeso(driverPayout)}
                  strong
                />
                <Row
                  label="PASADA commission"
                  value={formatPeso(platformCommission)}
                  tone="platform"
                />
                <Row
                  label="Passenger refund"
                  value={formatPeso(0)}
                  tone="muted"
                />
              </div>
              <p className="mt-3 flex items-center justify-between gap-3 text-[11px] text-ink-500">
                <span>Realtime ride record</span>
                <span className="num truncate">{liveRide?.id.slice(-12)}</span>
              </p>
              <div className="mt-4">
                <Button full onClick={reset}>
                  Back to map
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "pay" && (
        <DriverPay
          balanceSats={earningsSats}
          account={account}
          rides={rideHistory}
          phpPerBchCentavos={bchPhpQuote.phpPerBchCentavos}
          quoteSource={bchPhpQuote.source}
          walletMessage={walletMessage}
          onSync={() => void syncWallet()}
        />
      )}
      {tab === "activity" && <DriverActivity rides={rideHistory} />}
      {tab === "settings" && <DriverSettings account={account} />}

      {(tab !== "home" || stage === "idle") && (
        <BottomNav items={NAV} active={tab} onSelect={setTab} />
      )}
    </PhoneFrame>
  )
}

function browserLocation(_fallback: Point): Promise<Point> {
  if (!navigator.geolocation) {
    return Promise.reject(
      new Error(
        "Location services are required before a driver can go online.",
      ),
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
            error.message || "Allow location access before going online.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 7_000 },
    )
  })
}

function ActionSheet({
  title,
  sub,
  payout,
  children,
}: {
  title: string
  sub: string
  payout: number
  children: React.ReactNode
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-5 pt-4 pb-8">
      <span className="mx-auto block h-1 w-10 rounded-full bg-ink-100" />
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-extrabold">{title}</h2>
          <p className="mt-0.5 text-[12px] text-ink-500">{sub}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[9px] tracking-[0.12em] text-ink-300 uppercase">
            Payout
          </p>
          <p className="num text-[17px] font-medium">{formatPeso(payout)}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function DriverPay({
  balanceSats,
  account,
  rides,
  phpPerBchCentavos,
  quoteSource,
  walletMessage = "",
  onSync,
}: {
  balanceSats: number
  account: PasadaAccount
  rides: LiveRide[]
  phpPerBchCentavos: number
  quoteSource: "CoinGecko" | "Configured fallback"
  walletMessage?: string
  onSync: () => void
}) {
  const settled = rides.filter((ride) => ride.status === "settled")
  const balanceCentavos = satoshisToCentavos(balanceSats, {
    phpPerBchCentavos,
  })
  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-ink-50 px-5 pt-14 pb-28">
      <h1 className="font-display text-[26px] font-extrabold">
        Earnings &amp; Wallet
      </h1>
      <div className="mt-4 relative overflow-hidden rounded-2xl bg-ink p-5 text-white">
        <span className="absolute -top-16 -right-14 h-44 w-44 rounded-full bg-pasada-blue/25 blur-2xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.14em] text-white/45 uppercase">
              PASADA BCH balance
            </p>
            <p className="num mt-2 text-[34px] leading-none font-medium">
              {formatPeso(balanceCentavos)}
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
            {account.bchAddress || "Connecting wallet..."}
          </p>
          <span className="ml-3 shrink-0 font-mono text-[10px] tracking-[0.1em] text-white/70 uppercase">
            PASADA wallet
          </span>
        </div>
      </div>

      {/* Scannable Driver QR Code */}
      {account.bchAddress && (
        <div className="mt-3 flex flex-col items-center rounded-2xl border border-ink-100 bg-white p-5 text-center shadow-xs">
          <p className="font-mono text-[10px] tracking-[0.14em] text-ink-400 uppercase">
            Driver Payout QR Code
          </p>
          <div className="mt-3.5 flex flex-col items-center">
            <QRCode value={account.bchAddress} size={190} />
            <p className="num mt-3 text-[11px] break-all font-medium text-ink-700">
              {account.bchAddress}
            </p>
          </div>
        </div>
      )}

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

      <div className="mt-6">
        <SectionLabel>Settlement history</SectionLabel>
        <div className="mt-2 divide-y divide-ink-100 rounded-xl bg-white px-4">
          {settled.map((ride) => (
            <div key={ride.id} className="py-3">
              <Row
                label={`Ride payout · ${ride.from} → ${ride.to}`}
                detail={new Date(ride.updatedAt).toLocaleString()}
                value={formatPeso(Math.max(0, ride.total - ride.platformFee))}
                tone="credit"
              />
            </div>
          ))}
          {settled.length === 0 && (
            <p className="py-4 text-[12px] text-ink-300">
              No completed rides yet.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function DriverActivity({ rides }: { rides: LiveRide[] }) {
  const completed = rides.filter((ride) => ride.status === "settled")
  const cancelled = rides.filter((ride) => ride.status === "cancelled")
  const accepted = rides.filter((ride) => ride.driverId)
  const acceptance = rides.length
    ? `${Math.round((accepted.length / rides.length) * 100)}%`
    : "—"
  const earnings = completed.reduce(
    (total, ride) => total + Math.max(0, ride.total - ride.platformFee),
    0,
  )
  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-ink-50 px-5 pt-14 pb-28">
      <h1 className="font-display text-[26px] font-extrabold">Activity</h1>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[
          ["Completed", String(completed.length)],
          ["Cancelled", String(cancelled.length)],
          ["Acceptance", acceptance],
          ["Earnings", formatPeso(earnings)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-white p-4">
            <p className="font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
              {l}
            </p>
            <p className="num mt-1.5 text-xl font-medium">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 space-y-2">
        {rides.map((ride) => (
          <div key={ride.id} className="rounded-xl bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-[14px] font-bold">
                {ride.from} → {ride.to}
              </p>
              <p className="num text-[14px]">{formatPeso(ride.total)}</p>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Pill tone={ride.status === "cancelled" ? "red" : "muted"}>
                {ride.status}
              </Pill>
              <Pill tone="outline">{ride.distanceKm} km</Pill>
            </div>
          </div>
        ))}
        {rides.length === 0 && (
          <p className="rounded-xl bg-white p-4 text-[12px] text-ink-300">
            No rides yet.
          </p>
        )}
      </div>
    </div>
  )
}

function DriverSettings({ account }: { account: PasadaAccount }) {
  const displayName = account.displayName
  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-ink-50 px-5 pt-14 pb-28">
      <h1 className="font-display text-[26px] font-extrabold">Settings</h1>
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-white p-4">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-pasada-red font-display font-bold text-white">
          {displayName
            .split(" ")
            .slice(0, 2)
            .map((part) => part[0])
            .join("")}
        </div>
        <div>
          <p className="font-display text-[15px] font-bold">{displayName}</p>
          <p className="text-[11px] text-ink-500">
            Registered driver · {(account.trips ?? 0).toLocaleString()} trips
          </p>
        </div>
        <span className="ml-auto">
          <Pill tone="blue">Approved</Pill>
        </span>
      </div>

      <div className="mt-3 rounded-xl bg-white p-4">
        <SectionLabel>Vehicle</SectionLabel>
        <div className="mt-1 divide-y divide-ink-100">
          <Row label="Body & unit" value={account.vehicleBody || "Not set"} />
          <Row label="Plate" value={account.plate || "Not set"} />
          <Row label="Franchise capacity" value="6 seats" />
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-white p-4">
        <SectionLabel>Payout address</SectionLabel>
        <p className="num mt-2 text-[11px] break-all text-pasada-blue">
          {account.bchAddress}
        </p>
      </div>

      <WalletSigningKeyCard account={account} actionLabel="Link payout key" />

      <div className="mt-3">
        <Button
          full
          variant="outline"
          onClick={() => void logoutPasada("driver")}
        >
          Log out
        </Button>
      </div>
    </div>
  )
}
