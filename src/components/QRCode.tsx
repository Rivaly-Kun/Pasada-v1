import { useEffect, useMemo, useState } from "react"
import QrEncoder from "qrcode"

/** Creates a BCH payment URI which Paytaca and BCH scanners can open directly. */
export function formatBchUri(address: string, amountBch?: number): string {
  if (!address) return ""
  const trimmed = address.trim().toLowerCase()
  const hasPrefix =
    trimmed.startsWith("bchtest:") || trimmed.startsWith("bitcoincash:")
  const fullAddress = hasPrefix ? trimmed : `bchtest:${trimmed}`
  return amountBch && amountBch > 0
    ? `${fullAddress}?amount=${amountBch.toFixed(8)}`
    : fullAddress
}

/**
 * Renders a standards-compliant QR image. The previous custom matrix renderer
 * could look like a QR code without consistently encoding the BCH address.
 */
export default function QRCode({
  value,
  amountBch,
  size = 200,
  className = "",
}: {
  value: string
  amountBch?: number
  size?: number
  className?: string
  showBchLogo?: boolean
}) {
  const bchUri = useMemo(
    () => formatBchUri(value, amountBch),
    [value, amountBch],
  )
  const [imageSrc, setImageSrc] = useState("")

  useEffect(() => {
    let cancelled = false
    if (!bchUri) {
      setImageSrc("")
      return
    }

    void QrEncoder.toDataURL(bchUri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: Math.max(256, size * 2),
      color: { dark: "#0F172A", light: "#FFFFFF" },
    })
      .then((nextImageSrc) => {
        if (!cancelled) setImageSrc(nextImageSrc)
      })
      .catch(() => {
        if (!cancelled) setImageSrc("")
      })

    return () => {
      cancelled = true
    }
  }, [bchUri, size])

  if (!bchUri) return null

  return (
    <div
      className={`inline-block rounded-3xl border border-ink-100 bg-white p-4 shadow-xl ${className}`}
      data-qr-value={bchUri}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`BCH payment QR for ${bchUri}`}
          width={size}
          height={size}
          className="block"
        />
      ) : (
        <div
          className="grid place-items-center rounded-xl bg-ink-50 text-[11px] text-ink-400"
          style={{ width: size, height: size }}
        >
          Generating BCH QR…
        </div>
      )}
    </div>
  )
}
