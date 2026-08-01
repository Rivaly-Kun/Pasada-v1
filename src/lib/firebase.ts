import { getAnalytics, isSupported } from 'firebase/analytics'
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from 'firebase/auth'
import { getDatabase, type Database } from 'firebase/database'

export type AppRole = 'passenger' | 'driver'

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBuCLl0migQ2zmPqL78pPfIsKWBlflIRXw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'pasada-6a6a9.firebaseapp.com',
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    'https://pasada-6a6a9-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'pasada-6a6a9',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'pasada-6a6a9.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '508714010986',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:508714010986:web:0128378e2b34bde001bd13',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-CPPP7VP8QJ',
}

type RoleFirebase = {
  app: FirebaseApp
  auth: Auth
  database: Database
  persistenceReady: Promise<void>
}

const instances = new Map<AppRole, RoleFirebase>()

/** Each role receives its own named Firebase app and independent saved session. */
export function getScopedFirebase(role: AppRole): RoleFirebase {
  const existing = instances.get(role)
  if (existing) return existing

  const appName = `pasada-${role}`
  const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp(firebaseConfig, appName)
  const auth = getAuth(app)
  const instance = {
    app,
    auth,
    database: getDatabase(app),
    persistenceReady: setPersistence(auth, browserLocalPersistence).catch(() => undefined),
  }
  instances.set(role, instance)
  return instance
}

export const initAnalytics = async () => {
  if (typeof window !== 'undefined' && (await isSupported())) {
    return getAnalytics(getScopedFirebase('passenger').app)
  }
  return null
}
