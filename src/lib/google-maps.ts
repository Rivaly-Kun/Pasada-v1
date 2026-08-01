let googleMapsPromise: Promise<typeof google> | null = null

declare global {
  interface Window {
    __pasadaGoogleMapsReady?: () => void
  }
}

export function loadGoogleMaps(): Promise<typeof google> {
  const existing = (window as unknown as { google?: typeof google }).google
  if (existing?.maps?.importLibrary) return Promise.resolve(existing)
  if (googleMapsPromise) return googleMapsPromise

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error('Google Maps API key is not configured.'))

  googleMapsPromise = new Promise((resolve, reject) => {
    window.__pasadaGoogleMapsReady = () => {
      delete window.__pasadaGoogleMapsReady
      resolve(window.google)
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__pasadaGoogleMapsReady`
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Google Maps could not be loaded.'))
    document.head.appendChild(script)
  })

  return googleMapsPromise
}
