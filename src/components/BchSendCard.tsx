import { useMemo, useState } from "react"
import { getLocalPasadaWalletSigningKey } from "../lib/auth"
import {
  BCH_SEND_FEE_RESERVE_SATS,
  parseBchAmountToSats,
  sendBchTransfer,
  validateBchTransfer,
} from "../lib/bch-transfer"
import { formatBchFromSats } from "../lib/fare"

type SendStep = "closed" | "entry" | "review" | "sent"

export default function BchSendCard({
  senderAddress,
  balanceSats,
  accent,
  onSent,
}: {
  senderAddress: string
  balanceSats: number
  accent: "blue" | "red"
  onSent?: (txid: string) => void
}) {
  const [step, setStep] = useState<SendStep>("closed")
  const [recipientAddress, setRecipientAddress] = useState("")
  const [amountBch, setAmountBch] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [txid, setTxid] = useState("")
  const [copied, setCopied] = useState(false)

  const accentButton =
    accent === "red"
      ? "bg-pasada-red hover:bg-pasada-red-deep"
      : "bg-pasada-blue hover:bg-pasada-blue-deep"
  const accentText = accent === "red" ? "text-pasada-red" : "text-pasada-blue"
  const accentSoft =
    accent === "red" ? "bg-pasada-red/10" : "bg-pasada-blue/10"
  const networkLabel = senderAddress.toLowerCase().startsWith("bitcoincash:")
    ? "Mainnet"
    : "Chipnet"
  const amountSats = useMemo(() => {
    try {
      return parseBchAmountToSats(amountBch)
    } catch {
      return 0
    }
  }, [amountBch])

  const reset = () => {
    setStep("entry")
    setRecipientAddress("")
    setAmountBch("")
    setError("")
    setTxid("")
    setCopied(false)
  }

  const review = () => {
    setError("")
    try {
      const nextAmountSats = parseBchAmountToSats(amountBch)
      const validated = validateBchTransfer({
        senderAddress,
        recipientAddress,
        amountSats: nextAmountSats,
        availableSats: balanceSats,
      })
      setRecipientAddress(validated.recipientAddress)
      setStep("review")
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Review the BCH address and amount.",
      )
    }
  }

  const send = async () => {
    setSending(true)
    setError("")
    try {
      const privateKeyWif = getLocalPasadaWalletSigningKey(senderAddress)
      const result = await sendBchTransfer({
        privateKeyWif,
        senderAddress,
        recipientAddress,
        amountSats,
      })
      setTxid(result.txid)
      setStep("sent")
      onSent?.(result.txid)
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The BCH transaction could not be sent.",
      )
    } finally {
      setSending(false)
    }
  }

  const useMaximum = () => {
    const maximum = Math.max(0, balanceSats - BCH_SEND_FEE_RESERVE_SATS)
    setAmountBch(formatBchFromSats(maximum))
    setError("")
  }

  const copyTxid = async () => {
    if (!txid) return
    await navigator.clipboard.writeText(txid)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  if (step === "closed") {
    return (
      <button
        type="button"
        onClick={() => setStep("entry")}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl font-bold ${accentSoft} ${accentText}`}
        >
          ↗
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-bold text-ink">
            Send BCH
          </span>
          <span className="mt-0.5 block text-[11px] text-ink-500">
            Transfer from your PASADA wallet to another person
          </span>
        </span>
        <span className="font-mono text-[10px] font-bold text-ink-300">OPEN</span>
      </button>
    )
  }

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-md">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className={`grid h-8 w-8 place-items-center rounded-full font-bold ${accentSoft} ${accentText}`}
          >
            ↗
          </span>
          <div>
            <h2 className="font-display text-[15px] font-bold">Send BCH</h2>
            <p className="font-mono text-[9px] tracking-[0.1em] text-ink-300 uppercase">
              Signed securely in this browser
            </p>
          </div>
        </div>
        {step !== "sent" && (
          <button
            type="button"
            onClick={() => {
              setStep("closed")
              setError("")
            }}
            disabled={sending}
            aria-label="Close send BCH"
            className="grid h-8 w-8 place-items-center rounded-full bg-ink-50 text-lg text-ink-500 transition-colors hover:bg-ink-100 disabled:opacity-40"
          >
            ×
          </button>
        )}
      </div>

      {step === "entry" && (
        <div className="p-4">
          <label className="block">
            <span className="font-mono text-[9px] tracking-[0.13em] text-ink-500 uppercase">
              Recipient BCH address
            </span>
            <textarea
              value={recipientAddress}
              onChange={(event) => {
                setRecipientAddress(event.target.value)
                setError("")
              }}
              rows={3}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="bchtest:q..."
              className="num mt-1.5 w-full resize-none rounded-xl bg-ink-50 px-3 py-3 text-[11px] leading-relaxed break-all outline-none ring-1 ring-ink-100 placeholder:text-ink-300 focus:ring-pasada-blue"
            />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between gap-3">
              <span className="font-mono text-[9px] tracking-[0.13em] text-ink-500 uppercase">
                Amount
              </span>
              <button
                type="button"
                onClick={useMaximum}
                className={`font-mono text-[9px] font-bold tracking-[0.08em] uppercase ${accentText}`}
              >
                Use max
              </button>
            </span>
            <div className="mt-1.5 flex items-center rounded-xl bg-ink-50 px-3 ring-1 ring-ink-100 focus-within:ring-pasada-blue">
              <input
                value={amountBch}
                onChange={(event) => {
                  setAmountBch(event.target.value)
                  setError("")
                }}
                inputMode="decimal"
                placeholder="0.00000000"
                className="num min-w-0 flex-1 bg-transparent py-3 text-[14px] outline-none placeholder:text-ink-300"
              />
              <span className="ml-2 font-mono text-[10px] font-bold text-ink-500">
                BCH
              </span>
            </div>
          </label>
          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-ink-300">
            <span>{balanceSats.toLocaleString()} sats available</span>
            <span>Keep ~1,000 sats for fee</span>
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-pasada-red/8 px-3 py-2.5 text-[11px] leading-relaxed text-pasada-red">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={review}
            className={`mt-4 w-full rounded-xl py-3.5 font-display text-[14px] font-bold text-white transition-colors ${accentButton}`}
          >
            Review transfer
          </button>
        </div>
      )}

      {step === "review" && (
        <div className="p-4">
          <div className="rounded-xl bg-ink-50 p-3.5">
            <p className="font-mono text-[9px] tracking-[0.13em] text-ink-300 uppercase">
              You are sending
            </p>
            <p className="num mt-1.5 text-[25px] font-medium text-ink">
              {formatBchFromSats(amountSats)} BCH
            </p>
            <div className="mt-3 border-t border-ink-100 pt-3">
              <p className="text-[10px] text-ink-300">To</p>
              <p className="num mt-1 text-[10px] leading-relaxed break-all text-ink-700">
                {recipientAddress}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-ink-500">
            BCH transfers cannot be reversed. Confirm the address before signing.
          </p>
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-pasada-red/8 px-3 py-2.5 text-[11px] leading-relaxed text-pasada-red">
              {error}
            </p>
          )}
          <div className="mt-4 grid grid-cols-[0.8fr_1.2fr] gap-2">
            <button
              type="button"
              onClick={() => {
                setStep("entry")
                setError("")
              }}
              disabled={sending}
              className="rounded-xl border border-ink-100 py-3.5 font-display text-[13px] font-bold text-ink-700 transition-colors hover:border-ink disabled:opacity-40"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              className={`rounded-xl py-3.5 font-display text-[13px] font-bold text-white transition-colors disabled:opacity-50 ${accentButton}`}
            >
              {sending ? "Broadcasting…" : "Confirm & send"}
            </button>
          </div>
        </div>
      )}

      {step === "sent" && (
        <div className="p-4 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#0AC18E]/12 text-xl font-bold text-[#0AC18E]">
            ✓
          </span>
          <h3 className="mt-3 font-display text-[18px] font-extrabold">
            BCH sent
          </h3>
          <p className="num mt-1 text-[12px] font-medium text-ink-500">
            {formatBchFromSats(amountSats)} BCH broadcast to {networkLabel}
          </p>
          <button
            type="button"
            onClick={() => void copyTxid()}
            className="mt-4 w-full rounded-xl bg-ink-50 px-3 py-3 text-left ring-1 ring-ink-100"
          >
            <span className="block font-mono text-[9px] tracking-[0.12em] text-ink-300 uppercase">
              Transaction ID · {copied ? "Copied" : "Tap to copy"}
            </span>
            <span className="num mt-1 block truncate text-[10px] text-ink-700">
              {txid}
            </span>
          </button>
          <button
            type="button"
            onClick={reset}
            className={`mt-4 w-full rounded-xl py-3.5 font-display text-[13px] font-bold text-white transition-colors ${accentButton}`}
          >
            Send another
          </button>
        </div>
      )}
    </section>
  )
}
