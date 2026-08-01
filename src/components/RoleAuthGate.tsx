import { useEffect, useRef, useState, type ReactNode } from "react"
import { PhoneFrame } from "./PhoneFrame"
import IdentityVerificationPanel from "./IdentityVerificationPanel"
import { Button } from "./ui"
import {
  friendlyAuthError,
  linkPasadaWalletSigningKey,
  loadPasadaAccount,
  loginPasada,
  logoutPasada,
  observePasadaAuth,
  registerPasada,
} from "../lib/auth"
import {
  generateBchWallet,
  publicKeyForLocalBchWallet,
} from "../lib/bch-wallet"
import type { AppRole } from "../lib/firebase"
import type { ApprovedIdentityVerification } from "../lib/identity-verification"
import type { PasadaAccount } from "../lib/types"

export default function RoleAuthGate({
  role,
  children,
}: {
  role: AppRole
  children: (account: PasadaAccount) => ReactNode
}) {
  const [account, setAccount] = useState<PasadaAccount | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [sessionError, setSessionError] = useState("")
  const [sessionEmail, setSessionEmail] = useState("")
  const registrationInProgress = useRef(false)

  useEffect(
    () =>
      observePasadaAuth(role, (user) => {
        setAccount(null)
        if (!user) {
          setInitialized(true)
          return
        }
        // Firebase emits an authenticated user as soon as its email/password
        // account is created. Wait for registration to save the verified wallet
        // profile before loading it, otherwise legacy auto-provisioning can
        // briefly supply a different local address to the app UI.
        if (registrationInProgress.current) {
          setInitialized(false)
          return
        }
        setSessionError("")
        setSessionEmail("")
        setInitialized(false)
        void loadPasadaAccount(role, user)
          .then(setAccount)
          .catch(async (error) => {
            setSessionError(friendlyAuthError(error))
            setSessionEmail(user.email ?? "")
            await logoutPasada(role)
          })
          .finally(() => setInitialized(true))
      }),
    [role],
  )

  if (!initialized) {
    return (
      <PhoneFrame chrome={role.toUpperCase()} variant="auth">
        <div className="grid h-full place-items-center bg-white text-center text-ink">
          <div>
            <img src="/img/pasada-icon.png" alt="PASADA" className="mx-auto h-16 w-24 object-contain" />
            <span className="mx-auto mt-3 block h-7 w-7 animate-spin rounded-full border-2 border-ink-100 border-t-pasada-red" />
            <p className="mt-4 font-mono text-[10px] tracking-[0.14em] text-ink-500 uppercase">
              Restoring PASADA session...
            </p>
          </div>
        </div>
      </PhoneFrame>
    )
  }
  if (!account) {
    return (
      <RoleLoginPanel
        role={role}
        initialError={sessionError}
        initialEmail={sessionEmail}
        completeProfile={sessionError.includes("has no PASADA")}
        onRegistrationStateChange={(inProgress) => {
          registrationInProgress.current = inProgress
        }}
        onRegistrationComplete={async () => {
          setAccount(await loadPasadaAccount(role))
          setInitialized(true)
        }}
      />
    )
  }
  return children(account)
}

function RoleLoginPanel({
  role,
  initialError,
  initialEmail,
  completeProfile,
  onRegistrationStateChange,
  onRegistrationComplete,
}: {
  role: AppRole
  initialError: string
  initialEmail: string
  completeProfile: boolean
  onRegistrationStateChange: (inProgress: boolean) => void
  onRegistrationComplete: () => Promise<void>
}) {
  const [mode, setMode] = useState<"login" | "register">(
    completeProfile ? "register" : "login",
  )
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState("")
  const [plate, setPlate] = useState("")
  const [vehicleBody, setVehicleBody] = useState("")
  const [identityVerification, setIdentityVerification] =
    useState<ApprovedIdentityVerification | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)

  // Login stays intentionally light and distinct from the in-app appearance.
  useEffect(() => {
    document.documentElement.dataset.theme = "light"
  }, [])

  const roleLabel = role === "passenger" ? "Passenger" : "Driver"
  const registrationReady =
    displayName.trim().length > 1 &&
    email.trim().length > 3 &&
    password.length >= 6 &&
    Boolean(identityVerification) &&
    (role !== "driver" ||
      (plate.trim().length > 2 && vehicleBody.trim().length > 2))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      if (mode === "login") {
        await loginPasada(role, email, password)
        return
      }
      if (!identityVerification) {
        throw new Error("Verify your required ID images before creating an account.")
      }

      const generatedWallet = generateBchWallet()
      const bchPublicKey = publicKeyForLocalBchWallet(
        generatedWallet.privateKeyWif,
        generatedWallet.address,
      )

      onRegistrationStateChange(true)
      try {
        await registerPasada(role, {
          displayName,
          email,
          password,
          bchAddress: generatedWallet.address,
          walletMode: "local_wallet",
          bchPublicKey,
          identityVerification,
          plate,
          vehicleBody,
        })
        linkPasadaWalletSigningKey(
          generatedWallet.address,
          generatedWallet.privateKeyWif,
        )
        await onRegistrationComplete()
      } finally {
        onRegistrationStateChange(false)
      }
    } catch (cause) {
      setError(friendlyAuthError(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PhoneFrame chrome={role.toUpperCase()} variant="auth">
      <div className="scroll-quiet h-full overflow-y-auto bg-white px-5 pt-7 pb-8 text-ink">
        <header className="text-center">
          <img
            src="/img/pasada-icon.png"
            alt="PASADA BCH tricycle"
            className="mx-auto h-[72px] w-[122px] object-contain"
          />
          <div className="mt-1 flex items-center justify-center gap-2">
            <span className="font-display text-[18px] font-black tracking-tight">PASADA</span>
            <span className="h-1 w-1 rounded-full bg-ink-300" />
            <span className="font-mono text-[9px] tracking-[0.14em] text-ink-400 uppercase">
              Ormoc City
            </span>
          </div>
          <p
            className={`mt-4 font-mono text-[9px] font-bold tracking-[0.17em] uppercase ${
              role === "passenger" ? "text-pasada-blue" : "text-pasada-red"
            }`}
          >
            {roleLabel} access
          </p>
          <h1 className="mt-1 font-display text-[25px] leading-tight font-black">
            {mode === "login"
              ? `Welcome ${role === "passenger" ? "aboard" : "back"}`
              : `Join PASADA`}
          </h1>
          <p className="mx-auto mt-2 max-w-[276px] text-[11px] leading-relaxed text-ink-500">
            {mode === "login"
              ? `Sign in to your ${role.toLowerCase()} app and continue your journey.`
              : `Create your ${role.toLowerCase()} account in a few secure steps.`}
          </p>
        </header>

        <div className="mt-5 grid grid-cols-2 rounded-xl bg-ink-50 p-1">
          {(["login", "register"] as const).map((option) => {
            const active = mode === option
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option)
                  setError("")
                }}
                className={`rounded-lg py-2 text-[11px] font-bold transition-colors ${
                  active
                    ? "bg-white text-ink shadow-sm"
                    : "text-ink-400 hover:text-ink-700"
                }`}
              >
                {option === "login" ? "Log in" : "Create account"}
              </button>
            )
          })}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3.5">
          {mode === "register" && (
            <AuthField
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              autoComplete="name"
            />
          )}
          <AuthField
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete="email"
          />
          <AuthField
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
          />

          {mode === "register" && role === "driver" && (
            <div className="grid grid-cols-2 gap-2">
              <AuthField
                label="Plate number"
                value={plate}
                onChange={setPlate}
                autoComplete="off"
                placeholder="ORM-1234"
              />
              <AuthField
                label="Vehicle"
                value={vehicleBody}
                onChange={setVehicleBody}
                autoComplete="off"
                placeholder="Bajaj RE"
              />
            </div>
          )}

          {mode === "register" && (
            <IdentityVerificationPanel
              role={role}
              displayName={displayName}
              onVerificationChange={setIdentityVerification}
            />
          )}

          {mode === "register" && (
            <div className={`rounded-2xl border p-3.5 ${role === "passenger" ? "border-pasada-blue/20 bg-pasada-blue/5" : "border-pasada-red/20 bg-pasada-red/5"}`}>
              <p className={`font-mono text-[9px] tracking-[0.14em] uppercase ${role === "passenger" ? "text-pasada-blue" : "text-pasada-red"}`}>
                BCH wallet
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                PASADA creates a secure BCH Chipnet wallet in this browser when
                you register. Firebase receives public wallet data only.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-pasada-red/10 px-3 py-2.5 text-[12px] text-pasada-red">
              {error}
            </p>
          )}
          <Button
            type="submit"
            full
            variant={role === "passenger" ? "blue" : "red"}
            disabled={loading || (mode === "register" && !registrationReady)}
          >
            {loading
              ? "Please wait..."
              : mode === "login"
                ? `Log in as ${roleLabel}`
                : `Register ${roleLabel}`}
          </Button>
        </form>

        <p className="mt-5 text-center text-[10px] leading-relaxed text-ink-400">
          Passenger and driver sessions are independent. Your BCH wallet key stays in this browser.
        </p>
      </div>
    </PhoneFrame>
  )
}

function AuthField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  minLength,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete: string
  minLength?: number
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[9px] tracking-[0.14em] text-ink-500 uppercase">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        placeholder={placeholder}
        required
        className="w-full rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 text-[13px] text-ink outline-none placeholder:text-ink-300 focus:border-pasada-blue focus:bg-white"
      />
    </label>
  )
}
