import { useEffect, useMemo, useRef, useState } from "react"
import type { AppRole } from "../lib/firebase"
import {
  type ApprovedIdentityVerification,
  type IdentityDocumentSide,
  type IdentityDocumentType,
  type IdentityUpload,
  type VerificationOutcome,
  verifyIdentityDocuments,
} from "../lib/identity-verification"

type UploadSlot = {
  file: File
  preview: string
}

type SlotKey = `${IdentityDocumentType}_${IdentityDocumentSide}`

const documentName: Record<IdentityDocumentType, string> = {
  national_id: "National ID",
  student_id: "Student ID",
  drivers_license: "Driver's License",
}

function slotKey(documentType: IdentityDocumentType, side: IdentityDocumentSide): SlotKey {
  return `${documentType}_${side}`
}

function slotsFor(documentType: IdentityDocumentType) {
  return (["front", "back"] as const).map((side) => ({ documentType, side }))
}

function readPreview(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("This image could not be opened."))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

export default function IdentityVerificationPanel({
  role,
  displayName,
  onVerificationChange,
}: {
  role: AppRole
  displayName: string
  onVerificationChange: (value: ApprovedIdentityVerification | null) => void
}) {
  const [passengerDocument, setPassengerDocument] =
    useState<IdentityDocumentType>("national_id")
  const [selected, setSelected] = useState<Partial<Record<SlotKey, UploadSlot>>>({})
  const [loading, setLoading] = useState(false)
  const [verified, setVerified] = useState<ApprovedIdentityVerification | null>(null)
  const [outcome, setOutcome] = useState<VerificationOutcome | null>(null)
  const previousName = useRef(displayName)

  const requiredDocuments = useMemo<IdentityDocumentType[]>(
    () =>
      role === "passenger"
        ? [passengerDocument]
        : ["drivers_license"],
    [role, passengerDocument],
  )
  const requiredSlots = useMemo(
    () => requiredDocuments.flatMap((documentType) => slotsFor(documentType)),
    [requiredDocuments],
  )

  useEffect(() => {
    if (previousName.current === displayName) return
    previousName.current = displayName
    if (verified) {
      setVerified(null)
      onVerificationChange(null)
      setOutcome(null)
    }
  }, [displayName, onVerificationChange, verified])

  const resetApproval = () => {
    if (verified) setVerified(null)
    onVerificationChange(null)
    setOutcome(null)
  }

  const chooseDocument = (documentType: IdentityDocumentType) => {
    setPassengerDocument(documentType)
    setSelected({})
    resetApproval()
  }

  const chooseFile = async (
    documentType: IdentityDocumentType,
    side: IdentityDocumentSide,
    file?: File,
  ) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setOutcome({
        status: "retry",
        retryUploads: [{ documentType, side }],
        message: "Choose a JPG, PNG, or other image file for this ID side.",
        assessments: [],
      })
      return
    }
    if (file.size > 7 * 1024 * 1024) {
      setOutcome({
        status: "retry",
        retryUploads: [{ documentType, side }],
        message: "Each ID image must be 7 MB or smaller.",
        assessments: [],
      })
      return
    }
    try {
      console.log(`📁 [AI Verification UI] Selected ${documentType} (${side}): ${file.name} (${file.size} bytes)`)
      const preview = await readPreview(file)
      setSelected((current) => ({
        ...current,
        [slotKey(documentType, side)]: { file, preview },
      }))
      resetApproval()
    } catch (error) {
      console.error(`❌ [AI Verification UI] Error previewing ${file.name}:`, error)
      setOutcome({
        status: "retry",
        retryUploads: [{ documentType, side }],
        message: error instanceof Error ? error.message : "This image could not be opened.",
        assessments: [],
      })
    }
  }

  const clearSlot = (documentType: IdentityDocumentType, side: IdentityDocumentSide) => {
    console.log(`🗑️ [AI Verification UI] Cleared slot ${documentType} (${side})`)
    setSelected((current) => {
      const next = { ...current }
      delete next[slotKey(documentType, side)]
      return next
    })
    resetApproval()
  }

  const uploads: IdentityUpload[] = requiredSlots.flatMap(({ documentType, side }) => {
    const slot = selected[slotKey(documentType, side)]
    return slot ? [{ documentType, side, file: slot.file }] : []
  })
  const readyToVerify =
    displayName.trim().length > 1 && uploads.length === requiredSlots.length

  const verify = async () => {
    if (!readyToVerify || loading) {
      console.warn("⚠️ [AI Verification UI] Verify clicked but requirements not met (readyToVerify:", readyToVerify, "loading:", loading, ")")
      return
    }
    console.log(`🔍 [AI Verification UI] User clicked "Verify ID" button. Sending ${uploads.length} files to Gemini...`)
    setLoading(true)
    setOutcome(null)
    try {
      const nextOutcome = await verifyIdentityDocuments({
        role,
        displayName,
        uploads,
      })
      console.log(`✨ [AI Verification UI] Received verification outcome:`, nextOutcome)
      setOutcome(nextOutcome)
      if (nextOutcome.status === "approved") {
        setVerified(nextOutcome.approval)
        onVerificationChange(nextOutcome.approval)
      } else if (nextOutcome.status === "reset") {
        setSelected({})
        setVerified(null)
        onVerificationChange(null)
      } else {
        setSelected((current) => {
          const next = { ...current }
          nextOutcome.retryUploads.forEach(({ documentType, side }) => {
            delete next[slotKey(documentType, side)]
          })
          return next
        })
        setVerified(null)
        onVerificationChange(null)
      }
    } catch (error) {
      console.error(`❌ [AI Verification UI] Identity verification failed:`, error)
      setOutcome({
        status: "retry",
        retryUploads: [],
        message:
          error instanceof Error
            ? error.message
            : "Document verification could not be completed. Please try again.",
        assessments: [],
      })
      setVerified(null)
      onVerificationChange(null)
    } finally {
      setLoading(false)
    }
  }

  const accent = role === "passenger" ? "blue" : "red"
  return (
    <section className="rounded-2xl border border-ink-100 bg-ink-50 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] font-bold tracking-[0.14em] text-ink-500 uppercase">
            AI identity check
          </p>
          <h2 className="mt-1 font-display text-[15px] font-extrabold">
            {role === "passenger" ? "Verify your ride account" : "Verify your driver account"}
          </h2>
        </div>
        <span
          className={`rounded-full px-2 py-1 font-mono text-[8px] font-bold tracking-[0.1em] uppercase ${
            accent === "blue"
              ? "bg-pasada-blue/10 text-pasada-blue"
              : "bg-pasada-red/10 text-pasada-red"
          }`}
        >
          Gemini vision
        </span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
        Use a clear photo of the original ID. Gemini compares its visual layout to the PASADA reference documents before registration.
      </p>

      {role === "passenger" && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-bold text-ink-700">Choose your ID type</p>
          <div className="relative grid grid-cols-2 rounded-xl bg-white p-1 ring-1 ring-ink-100">
            <span
              className={`pointer-events-none absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg shadow-sm transition-transform duration-300 ${
                passengerDocument === "national_id"
                  ? "translate-x-0 bg-pasada-blue"
                  : "translate-x-full bg-pasada-blue"
              }`}
            />
            {([
              ["national_id", "National ID"],
              ["student_id", "Student ID"],
            ] as const).map(([documentType, label]) => (
              <button
                key={documentType}
                type="button"
                onClick={() => chooseDocument(documentType)}
                className={`relative z-10 rounded-lg px-2 py-2 text-[10px] font-bold transition-colors ${
                  passengerDocument === documentType ? "text-white" : "text-ink-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {requiredDocuments.map((documentType) => (
          <div key={documentType}>
            {role === "driver" && (
              <p className="mb-1.5 text-[10px] font-bold text-ink-700">
                {documentName[documentType]}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {slotsFor(documentType).map(({ side }) => {
                const slot = selected[slotKey(documentType, side)]
                return (
                  <DocumentUploadCard
                    key={side}
                    documentType={documentType}
                    side={side}
                    slot={slot}
                    onChoose={chooseFile}
                    onClear={clearSlot}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {outcome && (
        <VerificationFeedback outcome={outcome} documentName={documentName} />
      )}

      <button
        type="button"
        onClick={() => void verify()}
        disabled={!readyToVerify || loading || Boolean(verified)}
        className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-bold text-white transition-colors disabled:cursor-not-allowed disabled:bg-ink-100 ${
          accent === "blue" ? "bg-pasada-blue hover:bg-pasada-blue-deep" : "bg-pasada-red hover:bg-pasada-red-deep"
        }`}
      >
        {loading
          ? "Checking ID images…"
          : verified
            ? `Identity checked · ${verified.averageConfidence}%`
            : "Verify identity with Gemini"}
      </button>
      <p className="mt-2 text-center text-[9px] leading-relaxed text-ink-400">
        Your images are screened for document quality and stored privately only after approval.
      </p>
    </section>
  )
}

function DocumentUploadCard({
  documentType,
  side,
  slot,
  onChoose,
  onClear,
}: {
  documentType: IdentityDocumentType
  side: IdentityDocumentSide
  slot?: UploadSlot
  onChoose: (
    documentType: IdentityDocumentType,
    side: IdentityDocumentSide,
    file?: File,
  ) => void
  onClear: (documentType: IdentityDocumentType, side: IdentityDocumentSide) => void
}) {
  const inputId = `identity-${documentType}-${side}`
  return (
    <div className="relative min-w-0">
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => void onChoose(documentType, side, event.target.files?.[0])}
      />
      <label
        htmlFor={inputId}
        className={`relative flex min-h-[108px] cursor-pointer flex-col justify-end overflow-hidden rounded-xl border p-2.5 transition-colors ${
          slot
            ? "border-pasada-blue/35 bg-ink"
            : "border-dashed border-ink-300 bg-white hover:border-pasada-blue"
        }`}
      >
        {slot && (
          <img
            src={slot.preview}
            alt={`${documentName[documentType]} ${side} preview`}
            className="absolute inset-0 h-full w-full object-cover opacity-65"
          />
        )}
        <span className={`absolute inset-0 ${slot ? "bg-linear-to-t from-ink/90 via-ink/15" : ""}`} />
        <span className={`relative font-mono text-[8px] font-bold tracking-[0.12em] uppercase ${slot ? "text-white/65" : "text-ink-400"}`}>
          {side}
        </span>
        <span className={`relative mt-1 text-[10px] font-bold ${slot ? "truncate text-white" : "text-ink-700"}`}>
          {slot ? "Photo selected" : `Upload ${side}`}
        </span>
        <span className={`relative mt-0.5 text-[8px] ${slot ? "text-white/60" : "text-ink-400"}`}>
          {slot ? "Tap to replace" : "Clear, full ID"}
        </span>
      </label>
      {slot && (
        <button
          type="button"
          onClick={() => onClear(documentType, side)}
          className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-white text-[14px] font-bold text-ink shadow-sm"
          aria-label={`Remove ${side} image`}
        >
          ×
        </button>
      )}
    </div>
  )
}

function VerificationFeedback({
  outcome,
  documentName,
}: {
  outcome: VerificationOutcome
  documentName: Record<IdentityDocumentType, string>
}) {
  const success = outcome.status === "approved"
  const reset = outcome.status === "reset"
  const retryLabels =
    outcome.status === "retry"
      ? outcome.retryUploads.map((item) => `${documentName[item.documentType]} ${item.side}`).join(" · ")
      : ""
  return (
    <div
      className={`mt-3 rounded-xl px-3 py-2.5 text-[10px] leading-relaxed ${
        success
          ? "bg-[#0a9d72]/10 text-[#087a59]"
          : reset
            ? "bg-pasada-red/10 text-pasada-red"
            : "bg-[#f3a821]/12 text-[#8a5b00]"
      }`}
    >
      <p className="font-bold">{outcome.message}</p>
      {retryLabels && <p className="mt-1">Retake: {retryLabels}</p>}
      {!success && outcome.assessments.length > 0 && (
        <p className="mt-1 opacity-85">{outcome.assessments.map((item) => item.reason).join(" ")}</p>
      )}
    </div>
  )
}
