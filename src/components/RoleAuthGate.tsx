import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { PhoneFrame } from "./PhoneFrame"
import QRCode from "./QRCode"
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
  createBchOwnershipChallenge,
  generateBchWallet,
  normalizeAndValidateBchAddress,
  publicKeyForLocalBchWallet,
  type GeneratedBchWallet,
  verifyBchAddressOwnershipSignature,
} from "../lib/bch-wallet"
import {
  connectPaytacaWallet,
  requestPaytacaMessageSignature,
  type PaytacaWalletConnection,
} from "../lib/paytaca-walletconnect"
import type { AppRole } from "../lib/firebase"
import type { PasadaAccount, WalletMode } from "../lib/types"

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
  const [walletMode, setWalletMode] =
    useState<WalletMode>("paytaca_walletconnect")
  const [existingAddress, setExistingAddress] = useState("")
  const [addressChallenge, setAddressChallenge] = useState("")
  const [addressSignature, setAddressSignature] = useState("")
  const [addressPublicKey, setAddressPublicKey] = useState("")
  const [addressProofMessage, setAddressProofMessage] = useState("")
  const [paytacaConnection, setPaytacaConnection] =
    useState<PaytacaWalletConnection | null>(null)
  const [paytacaUri, setPaytacaUri] = useState("")
  const [paytacaPublicKey, setPaytacaPublicKey] = useState("")
  const [generatedWallet, setGeneratedWallet] =
    useState<GeneratedBchWallet | null>(null)
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [copied, setCopied] = useState<"address" | "key" | null>(null)
  const [loading, setLoading] = useState(false)
  const [walletLoading, setWalletLoading] = useState(false)
  const [error, setError] = useState(initialError)

  const addressValidation = useMemo(
    () => normalizeAndValidateBchAddress(existingAddress),
    [existingAddress],
  )
  const roleLabel = role === "passenger" ? "Passenger" : "Driver"
  const walletReady =
    walletMode === "paytaca_walletconnect"
      ? Boolean(paytacaConnection && paytacaPublicKey)
      : walletMode === "local_wallet"
        ? Boolean(generatedWallet && recoverySaved)
        : Boolean(addressValidation.valid && addressChallenge && addressPublicKey)
  const registrationReady =
    displayName.trim().length > 1 &&
    email.trim().length > 3 &&
    password.length >= 6 &&
    (role !== "driver" ||
      (plate.trim().length > 2 && vehicleBody.trim().length > 2)) &&
    walletReady

  const startPaytacaConnection = async () => {
    setWalletLoading(true)
    setError("")
    setPaytacaConnection(null)
    setPaytacaPublicKey("")
    setPaytacaUri("")
    try {
      const connection = await connectPaytacaWallet(setPaytacaUri)
      const challenge = createBchOwnershipChallenge(connection.address)
      const signature = await requestPaytacaMessageSignature(connection, challenge)
      const publicKey = verifyBchAddressOwnershipSignature(
        connection.address,
        challenge,
        signature,
      )
      setPaytacaConnection(connection)
      setPaytacaPublicKey(publicKey)
      setPaytacaUri("")
    } catch (cause) {
      setPaytacaUri("")
      setError(friendlyAuthError(cause))
    } finally {
      setWalletLoading(false)
    }
  }

  const createAddressChallenge = () => {
    if (!addressValidation.valid) {
      setAddressProofMessage(addressValidation.error)
      return
    }
    setAddressChallenge(createBchOwnershipChallenge(addressValidation.address))
    setAddressSignature("")
    setAddressPublicKey("")
    setAddressProofMessage("")
  }

  const verifyAddressOwnership = () => {
    try {
      if (!addressChallenge) {
        throw new Error("Create a fresh ownership challenge first.")
      }
      const publicKey = verifyBchAddressOwnershipSignature(
        existingAddress,
        addressChallenge,
        addressSignature,
      )
      setAddressPublicKey(publicKey)
      setAddressProofMessage("Address ownership verified. No wallet secret was shared.")
    } catch (cause) {
      setAddressPublicKey("")
      setAddressProofMessage(friendlyAuthError(cause))
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      if (mode === "login") {
        await loginPasada(role, email, password)
        return
      }

      const address =
        walletMode === "paytaca_walletconnect"
          ? (paytacaConnection?.address ?? "")
          : walletMode === "local_wallet"
            ? (generatedWallet?.address ?? "")
            : existingAddress
      const bchPublicKey =
        walletMode === "paytaca_walletconnect"
          ? paytacaPublicKey
          : walletMode === "local_wallet"
            ? publicKeyForLocalBchWallet(
                generatedWallet?.privateKeyWif ?? "",
                generatedWallet?.address ?? "",
              )
            : addressPublicKey

      if (walletMode === "local_wallet" && generatedWallet) {
        linkPasadaWalletSigningKey(
          generatedWallet.address,
          generatedWallet.privateKeyWif,
        )
      }
      onRegistrationStateChange(true)
      try {
        await registerPasada(role, {
          displayName,
          email,
          password,
          bchAddress: address,
          walletMode,
          bchPublicKey,
          ...(walletMode === "paytaca_walletconnect" && paytacaConnection
            ? { walletConnectTopic: paytacaConnection.topic }
            : {}),
          plate,
          vehicleBody,
        })
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

  const copy = async (kind: "address" | "key", value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 1400)
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
              <div className="mt-2 grid grid-cols-3 gap-2">
                <WalletChoice
                  active={walletMode === "paytaca_walletconnect"}
                  onClick={() => setWalletMode("paytaca_walletconnect")}
                  title="Connect Paytaca"
                  detail="WalletConnect"
                />
                <WalletChoice
                  active={walletMode === "local_wallet"}
                  onClick={() => setWalletMode("local_wallet")}
                  title="Create wallet"
                  detail="In this browser"
                />
                <WalletChoice
                  active={walletMode === "address_only"}
                  onClick={() => setWalletMode("address_only")}
                  title="Link address"
                  detail="Proof required"
                />
              </div>

              {walletMode === "paytaca_walletconnect" ? (
                <div className="mt-3 space-y-3">
                  {paytacaUri ? (
                    <div className="flex flex-col items-center gap-3 rounded-xl bg-white/8 p-3 text-center">
                      <QRCode value={paytacaUri} raw size={164} />
                      <p className="text-[10px] leading-relaxed text-white/60">
                        Scan with Paytaca, approve the BCH Chipnet connection,
                        then approve the ownership message.
                      </p>
                    </div>
                  ) : paytacaConnection ? (
                    <p className="rounded-xl bg-emerald-500/15 p-3 text-[11px] break-all text-emerald-200">
                      Paytaca address verified: {paytacaConnection.address}
                    </p>
                  ) : (
                    <p className="text-[10px] leading-relaxed text-white/55">
                      Connect directly to Paytaca through WalletConnect. PASADA
                      never asks for or receives a recovery phrase, WIF, or
                      private key.
                    </p>
                  )}
                  <Button
                    full
                    variant="blue"
                    disabled={walletLoading}
                    onClick={() => void startPaytacaConnection()}
                  >
                    {walletLoading
                      ? "Waiting for Paytaca..."
                      : paytacaConnection
                        ? "Reconnect Paytaca"
                        : "Connect Paytaca"}
                  </Button>
                </div>
              ) : walletMode === "address_only" ? (
                <div className="mt-3 space-y-3">
                  <AuthField
                    label="Bitcoin Cash address"
                    value={existingAddress}
                    onChange={(value) => {
                      setExistingAddress(value)
                      setAddressChallenge("")
                      setAddressSignature("")
                      setAddressPublicKey("")
                      setAddressProofMessage("")
                    }}
                    autoComplete="off"
                    placeholder="bchtest:q..."
                  />
                  {existingAddress && (
                    <p
                      className={`text-[10px] ${
                        addressValidation.valid
                          ? "text-emerald-300"
                          : "text-pasada-red"
                      }`}
                    >
                      {addressValidation.valid
                        ? "Valid BCH address. Prove ownership before registering."
                        : addressValidation.error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={createAddressChallenge}
                    disabled={!addressValidation.valid}
                    className="w-full rounded-xl border border-white/15 py-2.5 text-[11px] font-bold disabled:opacity-35"
                  >
                    Create ownership challenge
                  </button>
                  {addressChallenge && (
                    <>
                      <p className="rounded-xl bg-white/8 p-3 font-mono text-[9px] break-all whitespace-pre-wrap text-white/75">
                        {addressChallenge}
                      </p>
                      <AuthField
                        label="Signed message"
                        value={addressSignature}
                        onChange={setAddressSignature}
                        autoComplete="off"
                        placeholder="Base64 wallet signature"
                      />
                      <button
                        type="button"
                        onClick={verifyAddressOwnership}
                        disabled={!addressSignature.trim()}
                        className="w-full rounded-xl border border-pasada-blue/50 py-2.5 text-[11px] font-bold text-pasada-blue disabled:opacity-35"
                      >
                        Verify ownership
                      </button>
                    </>
                  )}
                  {addressProofMessage && (
                    <p
                      className={`text-[10px] leading-relaxed ${
                        addressPublicKey ? "text-emerald-300" : "text-pasada-red"
                      }`}
                    >
                      {addressProofMessage}
                    </p>
                  )}
                  <p className="text-[10px] leading-relaxed text-white/45">
                    Link a BCH address from any wallet that supports Bitcoin
                    Signed Message. A signature proves control; it never
                    exposes your private key.
                  </p>
                </div>
              ) : generatedWallet ? (
                <div className="mt-3 space-y-2.5">
                  <RecoveryValue
                    label="Your BCH address"
                    value={generatedWallet.address}
                    copied={copied === "address"}
                    onCopy={() => void copy("address", generatedWallet.address)}
                  />
                  <RecoveryValue
                    label="Private key — shown only now"
                    value={generatedWallet.privateKeyWif}
                    copied={copied === "key"}
                    onCopy={() => void copy("key", generatedWallet.privateKeyWif)}
                    danger
                  />
                  <label className="flex items-start gap-2 text-[11px] leading-relaxed text-white/65">
                    <input
                      type="checkbox"
                      checked={recoverySaved}
                      onChange={(event) => setRecoverySaved(event.target.checked)}
                      className="mt-0.5"
                    />
                    I saved the private key. This new wallet stays in this
                    browser; Firebase receives only public wallet data.
                  </label>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setGeneratedWallet(generateBchWallet())
                    setRecoverySaved(false)
                  }}
                  className="mt-3 w-full rounded-xl border border-white/15 py-3 font-display text-[12px] font-bold hover:bg-white/5"
                >
                  Generate secure BCH wallet
                </button>
              )}
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

function WalletChoice({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean
  onClick: () => void
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-2.5 text-left ${
        active ? "border-pasada-blue bg-pasada-blue/15" : "border-white/10"
      }`}
    >
      <span className="block font-display text-[10px] font-bold">{title}</span>
      <span className="mt-0.5 block text-[8px] leading-tight text-white/45">
        {detail}
      </span>
    </button>
  )
}

function RecoveryValue({
  label,
  value,
  copied,
  onCopy,
  danger,
}: {
  label: string
  value: string
  copied: boolean
  onCopy: () => void
  danger?: boolean
}) {
  return (
    <div className={`rounded-xl p-3 ${danger ? "bg-pasada-red/15" : "bg-white/8"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[8px] tracking-[0.12em] text-white/45 uppercase">
          {label}
        </p>
        <button type="button" onClick={onCopy} className="text-[9px] font-bold text-white/70">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="num mt-1.5 text-[10px] break-all text-white/85">{value}</p>
    </div>
  )
}
