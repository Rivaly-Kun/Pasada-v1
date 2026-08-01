import { useEffect, useRef, useState, type ReactNode } from "react"
import { PhoneFrame } from "./PhoneFrame"
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
      <PhoneFrame chrome={role.toUpperCase()}>
        <div className="grid h-full place-items-center bg-ink text-center text-white">
          <div>
            <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-pasada-red" />
            <p className="mt-4 font-mono text-[10px] tracking-[0.14em] text-white/60 uppercase">
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)

  const roleLabel = role === "passenger" ? "Passenger" : "Driver"
  const registrationReady =
    displayName.trim().length > 1 &&
    email.trim().length > 3 &&
    password.length >= 6 &&
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
    <PhoneFrame chrome={role.toUpperCase()}>
      <div className="scroll-quiet h-full overflow-y-auto bg-ink px-5 pt-14 pb-8 text-white">
        <p
          className={`font-mono text-[10px] tracking-[0.18em] uppercase ${
            role === "passenger" ? "text-pasada-blue" : "text-pasada-red"
          }`}
        >
          PASADA {roleLabel} app
        </p>
        <h1 className="mt-2 font-display text-[28px] leading-tight font-black">
          {mode === "login"
            ? `${roleLabel} login`
            : `Create ${roleLabel.toLowerCase()} account`}
        </h1>
        <p className="mt-2 text-[12px] leading-relaxed text-white/55">
          This session is independent from the {" "}
          {role === "passenger" ? "driver" : "passenger"} app.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
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
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
              <p className="font-mono text-[9px] tracking-[0.14em] text-white/45 uppercase">
                BCH wallet
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-white/55">
                PASADA creates a secure BCH Chipnet wallet in this browser when
                you register. Firebase receives public wallet data only.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-pasada-red/15 px-3 py-2.5 text-[12px] text-red-200">
              {error}
            </p>
          )}
          <Button
            type="submit"
            full
            disabled={loading || (mode === "register" && !registrationReady)}
          >
            {loading
              ? "Please wait..."
              : mode === "login"
                ? `Log in as ${roleLabel}`
                : `Register ${roleLabel}`}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((current) => (current === "login" ? "register" : "login"))
            setError("")
          }}
          className="mt-5 w-full text-center text-[12px] font-semibold text-white/70"
        >
          {mode === "login"
            ? `New ${roleLabel.toLowerCase()}? Create an account`
            : "Already registered? Log in"}
        </button>
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
      <span className="mb-1.5 block font-mono text-[9px] tracking-[0.14em] text-white/45 uppercase">
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
        className="w-full rounded-xl border border-white/12 bg-white/8 px-4 py-3 text-[13px] text-white outline-none placeholder:text-white/25 focus:border-pasada-blue"
      />
    </label>
  )
}
