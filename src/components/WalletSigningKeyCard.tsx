import { useState, type FormEvent } from "react"
import {
  hasLocalPasadaWalletKey,
  linkPasadaWalletSigningKey,
} from "../lib/auth"
import type { PasadaAccount } from "../lib/types"
import { Button, SectionLabel } from "./ui"

export default function WalletSigningKeyCard({
  account,
  actionLabel = "Link signing key",
}: {
  account: PasadaAccount
  actionLabel?: string
}) {
  const [key, setKey] = useState("")
  const [linked, setLinked] = useState(() =>
    hasLocalPasadaWalletKey(account.bchAddress),
  )
  const [editing, setEditing] = useState(!linked)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    try {
      linkPasadaWalletSigningKey(account.bchAddress, key)
      setKey("")
      setLinked(true)
      setEditing(false)
      setMessage("This browser can now sign BCH escrow for this address.")
    } catch (cause) {
      setMessage("")
      setError(
        cause instanceof Error
          ? cause.message
          : "The BCH signing key could not be linked.",
      )
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Escrow signing key</SectionLabel>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
            A BCH address can be read publicly, but escrow spending needs its
            matching private WIF key.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[9px] tracking-[0.1em] uppercase ${
            linked
              ? "bg-pasada-blue/10 text-pasada-blue"
              : "bg-pasada-red/10 text-pasada-red"
          }`}
        >
          {linked ? "Ready" : "Key needed"}
        </span>
      </div>

      {linked && !editing && (
        <button
          type="button"
          onClick={() => {
            setEditing(true)
            setMessage("")
          }}
          className="mt-3 text-[11px] font-semibold text-pasada-blue"
        >
          Replace signing key
        </button>
      )}

      {editing && (
        <form onSubmit={submit} className="mt-3">
          <label className="block">
            <span className="font-mono text-[9px] tracking-[0.14em] text-ink-400 uppercase">
              Private key (WIF)
            </span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="c... or L..."
              required
              className="mt-1.5 w-full rounded-xl border border-ink-100 bg-ink-50 px-3 py-2.5 text-[12px] outline-none focus:border-pasada-blue"
            />
          </label>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
            The key is verified against the address and stored in this browser
            only. Never enter a seed phrase.
          </p>
          <div className="mt-3 flex gap-2">
            <Button type="submit" full disabled={!key.trim()}>
              {actionLabel}
            </Button>
            {linked && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {message && (
        <p className="mt-3 rounded-lg bg-pasada-blue/10 px-3 py-2.5 text-[11px] text-pasada-blue">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-pasada-red/10 px-3 py-2.5 text-[11px] text-pasada-red">
          {error}
        </p>
      )}
    </div>
  )
}
