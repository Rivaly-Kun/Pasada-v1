import type { FareBreakdown, FareConfig, FareInput, FareLine } from './types'

/** All money in this module is integer centavos — never floats. */
export const PESO = 100
export const DEFAULT_PHP_PER_BCH_CENTAVOS = 32_450 * PESO

export const DEFAULT_FARE_CONFIG: FareConfig = {
  version: 'v3',
  effective: '2026-06-01',
  seatCapacity: 6,
  baseDistanceKm: 2.5,
  baseFarePerSeat: 10 * PESO,
  additionalFarePerKmPerSeat: 1.5 * PESO,
  pasadaUpfrontFee: 5 * PESO,
  platformTaxBps: 0,
  phpPerBchCentavos: DEFAULT_PHP_PER_BCH_CENTAVOS,
  specialTripFee: 5 * PESO,
  nightFeeWithinBase: 5 * PESO,
  nightFeeBeyondBase: 10 * PESO,
  nightStartHour: 21,
  nightEndHour: 5,
  discountsEnabled: true,
  discountPercent: 20,
  maxDiscountedSeats: 6,
}

export function formatPeso(centavos: number): string {
  const sign = centavos < 0 ? '-' : ''
  const abs = Math.abs(centavos)
  const whole = Math.floor(abs / PESO)
  const frac = String(abs % PESO).padStart(2, '0')
  return `${sign}₱${whole.toLocaleString('en-PH')}.${frac}`
}

export function isNightHour(config: FareConfig, date = new Date()): boolean {
  const h = date.getHours()
  return h >= config.nightStartHour || h < config.nightEndHour
}

function satoshiRate(config?: Pick<FareConfig, 'phpPerBchCentavos'>) {
  return Math.max(1, Math.trunc(config?.phpPerBchCentavos ?? DEFAULT_PHP_PER_BCH_CENTAVOS))
}

/** Integer conversion: centavos / rate-centavos BCH, rounded to the nearest satoshi. */
export function toSatoshis(centavos: number, config?: Pick<FareConfig, 'phpPerBchCentavos'>): number {
  return Math.round((Math.trunc(centavos) * 100_000_000) / satoshiRate(config))
}

export function toBch(centavos: number, config?: Pick<FareConfig, 'phpPerBchCentavos'>): string {
  return (toSatoshis(centavos, config) / 100_000_000).toFixed(8)
}

export function satoshisToCentavos(
  satoshis: number,
  config?: Pick<FareConfig, 'phpPerBchCentavos'>,
): number {
  return Math.round((Math.trunc(satoshis) * satoshiRate(config)) / 100_000_000)
}

export function formatBchFromSats(satoshis: number): string {
  return (satoshis / 1e8).toFixed(8)
}

/**
 * Ormoc Ordinance No. 121 s.2023 amounts, applied with PASADA's full-seat
 * buyout model. The declared passenger count is never a fare multiplier — the
 * fixed six-seat capacity is.
 */
export function calculateFare(config: FareConfig, input: FareInput): FareBreakdown {
  const extraDistanceKm = Math.max(0, input.tripDistanceKm - config.baseDistanceKm)
  const chargeableExtraKm = Math.ceil(extraDistanceKm)

  const farePerSeat =
    config.baseFarePerSeat + chargeableExtraKm * config.additionalFarePerKmPerSeat

  const eligible = config.discountsEnabled
    ? Math.min(input.discountedSeats, config.maxDiscountedSeats, config.seatCapacity)
    : 0
  const regularSeats = config.seatCapacity - eligible
  const discountedSeatFare = Math.round(farePerSeat * (1 - config.discountPercent / 100))

  const fullVehicleFare = farePerSeat * config.seatCapacity
  const vehicleFare = regularSeats * farePerSeat + eligible * discountedSeatFare
  const discount = vehicleFare - fullVehicleFare // negative or zero

  const specialFee = input.specialTrip ? config.specialTripFee : 0
  const nightFee = input.nightTrip
    ? input.tripDistanceKm <= config.baseDistanceKm
      ? config.nightFeeWithinBase
      : config.nightFeeBeyondBase
    : 0
  const surcharges = specialFee + nightFee

  const transportationFare = fullVehicleFare + discount + surcharges
  // Older in-flight rides can have a fare snapshot from before platform tax was
  // introduced. Treat a missing value as 0% so their original price remains valid.
  const platformTaxBps = Math.max(0, Number(config.platformTaxBps ?? 0))
  const platformTax = Math.round((transportationFare * platformTaxBps) / 10_000)
  const platformFee = config.pasadaUpfrontFee + platformTax
  const total = transportationFare + platformFee

  const lines: FareLine[] = [
    {
      label: 'Base tricycle fare',
      detail: `First ${config.baseDistanceKm} km · ${formatPeso(config.baseFarePerSeat)}/seat`,
      amount: config.baseFarePerSeat,
      tone: 'muted',
    },
    {
      label: 'Additional distance',
      detail:
        chargeableExtraKm > 0
          ? `${chargeableExtraKm} succeeding km × ${formatPeso(config.additionalFarePerKmPerSeat)}/seat`
          : 'Within base distance',
      amount: chargeableExtraKm * config.additionalFarePerKmPerSeat,
      tone: 'muted',
    },
    {
      label: 'Fare per seat',
      detail: `${formatPeso(farePerSeat)} × ${config.seatCapacity} billable seats`,
      amount: fullVehicleFare,
    },
  ]

  if (specialFee > 0) {
    lines.push({ label: 'Special-trip surcharge', detail: 'Off usual route', amount: specialFee })
  }
  if (nightFee > 0) {
    lines.push({
      label: 'Night-trip surcharge',
      detail: `${config.nightStartHour % 12 || 12}:00 PM – ${config.nightEndHour}:00 AM`,
      amount: nightFee,
    })
  }
  if (discount < 0) {
    lines.push({
      label: 'Verified passenger discount',
      detail: `${eligible} of ${config.seatCapacity} seats at ${config.discountPercent}% off`,
      amount: discount,
      tone: 'credit',
    })
  }

  lines.push({
    label: 'PASADA upfront fee',
    detail: 'Platform fee — billed separately from the driver fare',
    amount: config.pasadaUpfrontFee,
    tone: 'platform',
  })
  if (platformTax > 0) {
    lines.push({
      label: 'Platform tax',
      detail: `${(platformTaxBps / 100).toFixed(2)}% of transportation fare`,
      amount: platformTax,
      tone: 'platform',
    })
  }

  return {
    config,
    input,
    chargeableExtraKm,
    farePerSeat,
    vehicleFare: fullVehicleFare + discount,
    surcharges,
    discount,
    transportationFare,
    fixedPlatformFee: config.pasadaUpfrontFee,
    platformTax,
    platformFee,
    total,
    lines,
  }
}

/** Settlement split: everything except the platform fee goes to the driver. */
export function settlementOutputs(breakdown: FareBreakdown) {
  return {
    driverPayout: breakdown.transportationFare,
    platformCommission: breakdown.platformFee,
  }
}
