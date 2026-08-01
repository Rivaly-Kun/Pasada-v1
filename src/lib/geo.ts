export interface Point {
  lat: number
  lng: number
}

export interface Landmark extends Point {
  name: string
}

/**
 * Known pickup points around Ormoc. Google Routes snaps these coordinates to
 * the nearest usable road when calculating the passenger's route.
 */
export const LANDMARKS: Landmark[] = [
  { name: 'Ormoc City Superdome', lat: 11.00563, lng: 124.60748 },
  { name: 'Ormoc City Public Market', lat: 11.00502, lng: 124.60402 },
  { name: 'Brgy. Cogon, Ormoc', lat: 11.01113, lng: 124.61604 },
  { name: 'Ormoc Terminal, Brgy. Can-adieng', lat: 11.02732, lng: 124.60716 },
  { name: 'Gaisano Capital Ormoc', lat: 11.00692, lng: 124.60976 },
  { name: 'Robinsons Ormoc, Brgy. Punta', lat: 11.03422, lng: 124.60751 },
  { name: 'Ormoc District Hospital', lat: 11.01766, lng: 124.60885 },
  { name: 'Lake Danao Road, Brgy. Milagro', lat: 11.05451, lng: 124.65748 },
  { name: 'Brgy. Linao, Ormoc', lat: 11.02504, lng: 124.62537 },
  { name: 'Veterans Park, Brgy. District 22', lat: 11.00353, lng: 124.60639 },
]

export const ORMOC_CENTER: Point = { lat: 11.0104, lng: 124.6075 }

export const SM_CENTER_ORMOC: Landmark = {
  name: 'SM Center Ormoc',
  lat: 11.0102854,
  lng: 124.6078209,
}

export const ROBINSONS_PLACE_ORMOC: Landmark = {
  name: 'Robinsons Place Ormoc',
  lat: 11.024716,
  lng: 124.6046961,
}

export const DEMO_DRIVER_START: Point = { lat: 11.0048, lng: 124.6059 }

export function landmarkByName(name: string): Landmark {
  return LANDMARKS.find((landmark) => landmark.name === name) ?? LANDMARKS[0]
}

/** Haversine distance, used for nearest-driver matching and route fallback. */
export function distanceKm(a: Point, b: Point): number {
  const earthRadiusKm = 6371
  const lat1 = degreesToRadians(a.lat)
  const lat2 = degreesToRadians(b.lat)
  const deltaLat = degreesToRadians(b.lat - a.lat)
  const deltaLng = degreesToRadians(b.lng - a.lng)
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function roundedDistanceKm(a: Point, b: Point): number {
  return Math.max(0.3, Math.round(distanceKm(a, b) * 1.2 * 10) / 10)
}

/** Snap a dropped map pin to a named landmark when it is within 180 metres. */
export function resolveDrop(point: Point): { point: Point; name: string } {
  const closest = [...LANDMARKS].sort(
    (left, right) => distanceKm(left, point) - distanceKm(right, point),
  )[0]

  if (closest && distanceKm(closest, point) <= 0.18) {
    return { point: { lat: closest.lat, lng: closest.lng }, name: closest.name }
  }

  return {
    point,
    name: `Pinned location · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
  }
}

export function interpolatePoint(a: Point, b: Point, progress: number): Point {
  const t = Math.min(1, Math.max(0, progress))
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  }
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}
