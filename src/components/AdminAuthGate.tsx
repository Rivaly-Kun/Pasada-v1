import { useEffect, useState, type ReactNode } from "react"
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth"
import { verifyAdminRecord } from "../lib/admin-service"
import { getScopedFirebase } from "../lib/firebase"

export default function AdminAuthGate({
  children,
}: {
  children: (session: { user: User logout: () => Promise<void> }) => ReactNode
}) {
  const [user, setUser] = useState<User | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [sessionError, setSessionError] = useState("")

  useEffect(() => {
    const scoped = getScopedFirebase("admin")
    let unsubscribe = () => undefined
    let cancelled = false
    void scoped.persistenceReady.then(() => {
      if (cancelled) return
      unsubscribe = onAuthStateChanged(scoped.auth, (nextUser) => {
        setInitialized(false)
        if (!nextUser) {
          setUser(null)
          setInitialized(true)
          return
        }
        void verifyAdminRecord(nextUser.uid)
          .then(() => {
            setSessionError("")
            setUser(nextUser)
          })
          .catch(async (error) => {
            setSessionError(
              error instanceof Error
                ? error.message
                : "This account cannot access PASADA administration.",
            )
            setUser(null)
            await signOut(scoped.auth)
          })
          .finally(() => setInitialized(true))
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (!initialized) {
    return (
      <div className="grid min-h-[680px] place-items-center rounded-3xl bg-white shadow-xl ring-1 ring-ink/10">
        <div className="text-center">
          <img
            src="/img/LOGO.svg"
            alt="PASADA"
            className="mx-auto h-20 w-32 object-contain"
          />
          <span className="mx-auto mt-4 block h-8 w-8 animate-spin rounded-full border-2 border-ink-100 border-t-pasada-red" />
          <p className="mt-4 font-mono text-[10px] tracking-[0.14em] text-ink-400 uppercase">
            Securing admin session
          </p>
        </div>
      </div>
    )
  }

  if (!user) return <AdminLogin initialError={sessionError} />

  return children({
    user,
    logout: () => signOut(getScopedFirebase("admin").auth),
  })
}

function AdminLogin({ initialError }: { initialError: string }) {
  const [email, setEmail] = useState("admin@gmail.com")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      const scoped = getScopedFirebase("admin")
      await scoped.persistenceReady
      const credential = await signInWithEmailAndPassword(
        scoped.auth,
        email.trim().toLowerCase(),
        password,
      )
      await verifyAdminRecord(credential.user.uid)
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message.includes("authorized")
          ? nextError.message
          : "Invalid administrator email or password.",
      )
      await signOut(getScopedFirebase("admin").auth).catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mx-auto min-h-[680px] w-full max-w-[1060px] overflow-hidden rounded-3xl bg-white shadow-[0_40px_100px_-40px_rgba(11,11,12,0.55)] ring-1 ring-ink/10 lg:grid lg:grid-cols-[1.08fr_.92fr]">
      <div className="relative flex min-h-[330px] flex-col overflow-hidden bg-ink p-8 text-white lg:min-h-[680px] lg:p-12">
        <span className="absolute -top-24 -right-20 h-72 w-72 rounded-full bg-pasada-blue/20 blur-3xl" />
        <span className="absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-pasada-red/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white">
            <img
              src="/img/LOGO.svg"
              alt="PASADA"
              className="h-10 w-12 object-contain"
            />
          </span>
          <div>
            <p className="font-display text-2xl font-black tracking-tight">
              PASADA
            </p>
            <p className="font-mono text-[9px] tracking-[0.17em] text-white/40 uppercase">
              Ormoc operations center
            </p>
          </div>
        </div>

        <div className="relative my-auto py-10">
          <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[9px] tracking-[0.14em] text-pasada-blue uppercase">
            Firebase secured
          </span>
          <h1 className="mt-5 max-w-lg font-display text-4xl leading-[1.03] font-black lg:text-5xl">
            Run every PASADA operation from one live console.
          </h1>
          <p className="mt-5 max-w-md text-[13px] leading-relaxed text-white/50">
            Monitor riders, drivers, fares, BCH escrow settlements, account
            standing, and the Chipnet platform wallet in real time.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-2 border-t border-white/10 pt-5">
          {["Live fares", "Account controls", "BCH audit"].map((label) => (
            <div key={label}>
              <span className="block h-1.5 w-1.5 rounded-full bg-pasada-blue" />
              <p className="mt-2 text-[10px] text-white/45">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center p-7 lg:p-12">
        <form onSubmit={submit} className="mx-auto w-full max-w-[360px]">
          <p className="font-mono text-[9px] font-bold tracking-[0.16em] text-pasada-red uppercase">
            Restricted access
          </p>
          <h2 className="mt-2 font-display text-[30px] font-black">
            Admin login
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
            Sign in with the Firebase administrator account to continue.
          </p>

          <label className="mt-7 block">
            <span className="font-mono text-[9px] tracking-[0.13em] text-ink-500 uppercase">
              Email address
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              className="mt-1.5 w-full rounded-xl bg-ink-50 px-4 py-3.5 text-[13px] outline-none ring-1 ring-ink-100 transition focus:ring-ink"
            />
          </label>
          <label className="mt-4 block">
            <span className="font-mono text-[9px] tracking-[0.13em] text-ink-500 uppercase">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={6}
              required
              placeholder="Enter administrator password"
              className="mt-1.5 w-full rounded-xl bg-ink-50 px-4 py-3.5 text-[13px] outline-none ring-1 ring-ink-100 transition placeholder:text-ink-300 focus:ring-ink"
            />
          </label>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-pasada-red/10 px-3.5 py-3 text-[11px] leading-relaxed text-pasada-red"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-5 w-full rounded-xl bg-ink py-4 font-display text-[14px] font-bold text-white transition-colors hover:bg-ink-700 disabled:opacity-40"
          >
            {loading ? "Verifying administrator…" : "Enter admin console"}
          </button>
          <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-ink-300">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0AC18E]" />
            BCH Chipnet operations only
          </div>
        </form>
      </div>
    </section>
  )
}
