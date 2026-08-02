export type Role = "passenger" | "driver" | "admin"

export type WalletMode = "local_wallet"

export type PaymentMethod = "bch"

export type DiscountClass = "senior" | "pwd" | "student"

/**
 * A snapshot of every tunable the fare engine reads. Bookings capture the
 * version that was active when the passenger confirmed, so later admin edits
 * never retroactively change a settled or in-flight ride.
 */
export interface FareConfig {
  version: string
  effective: string
  seatCapacity: number
  baseDistanceKm: number
  /** Centavos. */
  baseFarePerSeat: number
  additionalFarePerKmPerSeat: number
  pasadaUpfrontFee: number
  /** Percentage in basis points. 250 = 2.50%. Applied to the transportation fare. */
  platformTaxBps: number
  /** PHP/BCH conversion rate in centavos, used only to produce integer satoshis. */
  phpPerBchCentavos: number
  specialTripFee: number
  nightFeeWithinBase: number
  nightFeeBeyondBase: number
  nightStartHour: number
  nightEndHour: number
  discountsEnabled: boolean
  discountPercent: number
  maxDiscountedSeats: number
}

export interface FareInput {
  tripDistanceKm: number
  passengers: number
  discountedSeats: number
  specialTrip: boolean
  nightTrip: boolean
  /** Fixed-value PRC coupon amount in Philippine pesos. */
  couponDiscountPhp?: number
}

export interface FareLine {
  label: string
  detail?: string
  /** Centavos. Negative for discounts. */
  amount: number
  tone?: "default" | "muted" | "credit" | "platform"
}

export interface FareBreakdown {
  config: FareConfig
  input: FareInput
  /** Seats charged for this booking: four minimum, then each declared rider up to six. */
  billableSeats: number
  chargeableExtraKm: number
  farePerSeat: number
  vehicleFare: number
  surcharges: number
  discount: number
  transportationFare: number
  fixedPlatformFee: number
  platformTax: number
  platformFee: number
  /** Gross total before a PRC coupon, in centavos. */
  grossTotal: number
  /** Applied PRC coupon value, in centavos. */
  couponDiscount: number
  total: number
  lines: FareLine[]
}

export type RideStatus = "idle" | "quoting" | "funding" | "searching" | "accepted" | "arriving" | "awaiting_pin" | "in_transit" | "completing" | "settled" | "cancelled"

export interface Driver {
  id: string
  name: string
  plate: string
  body: string
  rating: number
  trips: number
  etaMin: number
  bchAddress: string
}

export interface GeoPoint {
  lat: number
  lng: number
}

export type DispatchRideStatus = "searching" | "funding" | "accepted" | "arriving" | "awaiting_pin" | "in_transit" | "completing" | "settled" | "cancelled"

export interface PasadaAccount {
  uid: string
  firebaseUid: string
  role: "passenger" | "driver"
  displayName: string
  /** Small profile image stored with the public role profile (optional). */
  avatarDataUrl?: string
  bchAddress: string
  /** CashToken-aware encoding of the same P2PKH locking script. */
  chipnetTokenAddress: string
  /** Public passenger referral code, e.g. PASADA-GABZ77. */
  referralCode?: string
  referredByCode?: string
  referredByUid?: string
  bchPublicKey: string
  walletMode: WalletMode
  availableCentavos: number
  availableSats: number
  authenticated: boolean
  plate?: string
  vehicleBody?: string
  rating?: number
  trips?: number
}

export interface LiveDriver {
  id: string
  name: string
  plate: string
  body: string
  rating: number
  trips: number
  bchAddress: string
  bchPublicKey: string
  online: boolean
  available: boolean
  assignedRideId: string | null
  location: GeoPoint
  updatedAt: number
}

export interface LiveRide {
  id: string
  passengerId: string
  passengerName: string
  passengerBchAddress: string
  /** Public key only; lets the driver prepare the covenant without a passenger secret. */
  passengerPublicKey: string
  driverId: string | null
  driverName: string | null
  driver: LiveDriver | null
  from: string
  to: string
  pickup: GeoPoint
  destination: GeoPoint
  distanceKm: number
  durationMin: number
  distanceToPickupKm: number | null
  passengers: number
  discountedSeats: number
  specialTrip: boolean
  nightTrip: boolean
  method: PaymentMethod
  paymentStatus: "awaiting_driver" | "funding" | "funding_broadcasting" | "funded" | "settling" | "refunded" | "settled" | "failed"
  fareSats: number
  transportationFareSats: number
  platformFeeSats: number
  platformTaxSats: number
  driverPayoutSats: number
  platformAccountId: string
  platformBchAddress: string | null
  appliedCoupon?: {
    symbol: "PRC"
    categoryId: string
    amount: 1
    discountPhp: number
    passengerTokenAddress: string
    redemptionTokenAddress: string
    status: "reserved" | "redeemed"
    redemptionTxid?: string
  }
  /** Fixed PRC discount in Philippine pesos. */
  discountPhp?: number
  /** Persisted pre-broadcast error, e.g. a missing local signing key. */
  fundingError?: string
  escrow?: {
    contractAddress: string
    network: "chipnet" | "mainnet"
    passengerAddress: string
    driverAddress: string
    platformAddress: string
    passengerPublicKey: string
    driverPublicKey: string
    passengerPkh: string
    driverPkh: string
    platformPkh: string
    driverPayoutSats: number
    platformFeeSats: number
    releaseFeeSats: number
    fundingSats: number
    fundingTxid?: string
    settlementTxid?: string
    refundTxid?: string
    error?: string
  }
  demoMode?: boolean
  demoDriverApproachProgress?: number
  total: number
  platformFee: number
  config: FareConfig
  pin: string
  status: DispatchRideStatus
  progress: number
  rejectedDriverIds: Record<string, boolean | number>
  createdAt: number
  updatedAt: number
  acceptedAt?: number
  settledAt?: number
  cancelledAt?: number
  onChainTxid?: string
  onChainBroadcast?: boolean
}

export interface WalletEntry {
  id: string
  label: string
  detail: string
  /** Centavos, signed. */
  amount: number
  txid?: string
  at: string
}

export interface RideRecord {
  id: string
  from: string
  to: string
  distanceKm: number
  status: "completed" | "cancelled" | "active"
  method: PaymentMethod
  total: number
  driver: string
  configVersion: string
  txid?: string
  at: string
}

export interface ManagedUser {
  id: string
  name: string
  kind: "passenger" | "driver"
  state: "active" | "pending" | "suspended" | "rejected"
  bchAddress: string
  joined: string
  trips: number
  vehicle?: string
}

export interface ChainTx {
  id: string
  txid: string
  kind: "escrow_fund" | "settlement" | "refund" | "commission"
  amount: number
  confirmations: number
  at: string
}

export interface CashTokenConfig {
  network: "chipnet"
  name: "PASADA Referral Credit"
  symbol: "PRC"
  categoryId: string
  totalSupply: number
  couponValuePhp: number
  maxCouponsPerRide: 1
  issuerAddress: string
  issuerTokenAddress: string
  redemptionTokenAddress: string
  preGenesisTxid: string
  genesisTxid: string
  initializedAt: number
  initializedBy: string
}

export interface ReferralRewardClaim {
  id: string
  referredPassengerId: string
  referredPassengerName: string
  referredPassengerEmail?: string
  referrerUid: string
  referrerName: string
  referrerEmail?: string
  referrerCode: string
  referrerTokenAddress: string
  /** Referral claims are created at passenger signup, before any ride exists. */
  source: "signup_referral"
  rideId?: string
  amount: 1
  status: "pending" | "processing" | "sent" | "failed"
  txid?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export interface CashTokenActivity {
  id: string
  type: "genesis" | "referral_reward" | "coupon_redemption" | "admin_grant"
  status: "pending" | "processing" | "confirmed" | "failed"
  amount: number
  txid?: string
  rideId?: string
  referrerUid?: string
  referrerName?: string
  referredPassengerId?: string
  referredPassengerName?: string
  error?: string
  createdAt: number
  updatedAt: number
}
