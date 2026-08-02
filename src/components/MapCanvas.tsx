import { useEffect, useRef, useState } from 'react'
import {
  distanceKm,
  interpolatePoint,
  LANDMARKS,
  ORMOC_CENTER,
  type Point,
} from '../lib/geo'
import { loadGoogleMaps } from '../lib/google-maps'

type RouteMetrics = {
  distanceKm: number
  durationMin: number
  source: 'google' | 'fallback'
}

type AdvancedMarker = google.maps.marker.AdvancedMarkerElement

export default function MapCanvas({
  pickup,
  dest,
  route = false,
  driver = false,
  driverProgress = 0,
  driverPosition,
  onPick,
  onRoute,
  showLandmarks = false,
}: {
  pickup?: Point
  dest?: Point
  route?: boolean
  driver?: boolean
  driverProgress?: number
  driverPosition?: Point
  onPick?: (point: Point) => void
  onRoute?: (metrics: RouteMetrics) => void
  showLandmarks?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerClassRef = useRef<typeof google.maps.marker.AdvancedMarkerElement | null>(null)
  const routeClassRef = useRef<typeof google.maps.routes.Route | null>(null)
  const routePolylinesRef = useRef<google.maps.Polyline[]>([])
  const markersRef = useRef<AdvancedMarker[]>([])
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const onPickRef = useRef(onPick)
  const onRouteRef = useRef(onRoute)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  const from = pickup ?? LANDMARKS[2]
  const to = dest ?? LANDMARKS[0]

  useEffect(() => {
    onPickRef.current = onPick
    onRouteRef.current = onRoute
  }, [onPick, onRoute])

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        const maps = await loadGoogleMaps()
        const [{ Map }, { AdvancedMarkerElement }, { Route }] = await Promise.all([
          maps.maps.importLibrary('maps'),
          maps.maps.importLibrary('marker'),
          maps.maps.importLibrary('routes'),
        ])
        if (cancelled || !containerRef.current) return

        mapRef.current = new Map(containerRef.current, {
          center: ORMOC_CENTER,
          zoom: 14,
          mapId: 'DEMO_MAP_ID',
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        })
        markerClassRef.current = AdvancedMarkerElement
        routeClassRef.current = Route
        setReady(true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Google Maps could not be loaded.')
      }
    }

    void initialize()
    return () => {
      cancelled = true
      clickListenerRef.current?.remove()
      routePolylinesRef.current.forEach((polyline) => polyline.setMap(null))
      markersRef.current.forEach((marker) => {
        marker.map = null
      })
    }
  }, [])

  useEffect(() => {
    if (!ready || !mapRef.current) return
    clickListenerRef.current?.remove()
    clickListenerRef.current = mapRef.current.addListener('click', (event: google.maps.MapMouseEvent) => {
      const point = event.latLng
      if (!point || !onPickRef.current) return
      onPickRef.current({ lat: point.lat(), lng: point.lng() })
    })
  }, [ready, Boolean(onPick)])

  useEffect(() => {
    if (!ready || !mapRef.current || !markerClassRef.current) return

    markersRef.current.forEach((marker) => {
      marker.map = null
    })
    markersRef.current = []

    const Marker = markerClassRef.current
    markersRef.current.push(
      new Marker({
        map: mapRef.current,
        position: from,
        title: 'Pickup',
        content: markerElement('pickup'),
      }),
    )
    if (route || dest) {
      markersRef.current.push(
        new Marker({
          map: mapRef.current,
          position: to,
          title: 'Drop-off',
          content: markerElement('destination'),
        }),
      )
    }
    if (driver) {
      markersRef.current.push(
        new Marker({
          map: mapRef.current,
          position: driverPosition ?? interpolatePoint(from, to, driverProgress),
          title: 'Driver',
          content: markerElement('driver'),
          zIndex: 10,
        }),
      )
    }
    if (showLandmarks) {
      LANDMARKS.forEach((landmark) => {
        markersRef.current.push(
          new Marker({
            map: mapRef.current,
            position: landmark,
            title: landmark.name,
            content: markerElement('landmark'),
          }),
        )
      })
    }
  }, [ready, from.lat, from.lng, to.lat, to.lng, route, driver, driverProgress, showLandmarks, driverPosition?.lat, driverPosition?.lng])

  useEffect(() => {
    if (!ready || !mapRef.current || !routeClassRef.current) return
    let cancelled = false
    routePolylinesRef.current.forEach((polyline) => polyline.setMap(null))
    routePolylinesRef.current = []

    if (!route) {
      mapRef.current.setCenter(from)
      mapRef.current.setZoom(15)
      return
    }

    async function drawRoute() {
      try {
        const result = await routeClassRef.current!.computeRoutes({
          origin: from,
          destination: to,
          travelMode: 'DRIVING',
          routingPreference: 'TRAFFIC_AWARE',
          fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
        })
        const googleRoute = result.routes?.[0]
        if (cancelled || !googleRoute || !mapRef.current) throw new Error('No Google route found.')

        const polylines = googleRoute.createPolylines()
        polylines.forEach((polyline) => polyline.setMap(mapRef.current))
        routePolylinesRef.current = polylines
        if (googleRoute.viewport) mapRef.current.fitBounds(googleRoute.viewport, 44)
        onRouteRef.current?.({
          distanceKm: Math.max(0.3, Math.round(((googleRoute.distanceMeters ?? 0) / 1000) * 10) / 10),
          durationMin: Math.max(1, Math.ceil((googleRoute.durationMillis ?? 0) / 60_000)),
          source: 'google',
        })
      } catch (cause) {
        if (cancelled || !mapRef.current) return
        const bounds = new google.maps.LatLngBounds()
        bounds.extend(from)
        bounds.extend(to)
        mapRef.current.fitBounds(bounds, 48)
        onRouteRef.current?.({
          distanceKm: Math.max(0.3, Math.round(distanceKm(from, to) * 1.2 * 10) / 10),
          durationMin: Math.max(1, Math.ceil((distanceKm(from, to) * 1.2 * 60) / 22)),
          source: 'fallback',
        })
        console.warn('Google Routes was unavailable; using a local distance estimate.', cause)
      }
    }

    void drawRoute()
    return () => {
      cancelled = true
    }
  }, [ready, route, from.lat, from.lng, to.lat, to.lng])

  return (
    <div className="absolute inset-0 overflow-hidden bg-map">
      <div
        ref={containerRef}
        className={`h-full w-full ${onPick ? 'cursor-crosshair' : ''}`}
        role={onPick ? 'application' : undefined}
        aria-label={onPick ? 'Tap the Google map to set your drop-off point' : 'Google map'}
      />

      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center bg-map text-center">
          <p className="font-mono text-[10px] tracking-[0.12em] text-white/70 uppercase">
            Loading Google Maps…
          </p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-map px-8 text-center">
          <p className="text-[12px] leading-relaxed text-white/80">{error}</p>
        </div>
      )}
    </div>
  )
}

function markerElement(kind: 'pickup' | 'destination' | 'driver' | 'landmark') {
  const element = document.createElement('span')
  element.setAttribute('aria-hidden', 'true')
  if (kind === 'pickup') {
    element.className = 'block h-4 w-4 rounded-full border-[3px] border-white bg-pasada-red shadow-lg'
  } else if (kind === 'destination') {
    element.className = 'block h-4 w-4 border-[3px] border-white bg-ink shadow-lg'
  } else if (kind === 'driver') {
    element.className =
      'block h-5 w-5 rounded-full border-[3px] border-white bg-pasada-blue shadow-[0_0_0_8px_rgba(74,114,184,0.25)]'
  } else {
    element.className = 'block h-2 w-2 rounded-full border border-white bg-ink-300 shadow'
  }
  return element
}
