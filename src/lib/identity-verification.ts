import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage"
import { getScopedFirebase, type AppRole } from "./firebase"

export type IdentityDocumentType =
  | "national_id"
  | "student_id"
  | "drivers_license"
export type IdentityDocumentSide = "front" | "back"

export type IdentityUpload = {
  documentType: IdentityDocumentType
  side: IdentityDocumentSide
  file: File
}

export type ApprovedIdentityVerification = {
  approved: true
  role: AppRole
  verifiedDisplayName: string
  approvedAt: number
  model: "gemini-3.6-flash"
  averageConfidence: number
  uploads: IdentityUpload[]
}

export type StoredIdentityVerification = Omit<
  ApprovedIdentityVerification,
  "uploads" | "verifiedDisplayName"
> & {
  documents: Array<{
    documentType: IdentityDocumentType
    side: IdentityDocumentSide
    storagePath: string
    contentType: string
    size: number
  }>
}

type SideAssessment = {
  confidence: number
  documentPresent: boolean
  correctSide: boolean
  clearEnough: boolean
  visuallyPlausible: boolean
  issue: string
}

type DocumentAssessment = {
  documentType: IdentityDocumentType
  overallConfidence: number
  front: SideAssessment
  back: SideAssessment
  reason: string
}

export type VerificationOutcome =
  | {
      status: "approved"
      approval: ApprovedIdentityVerification
      message: string
      assessments: DocumentAssessment[]
    }
  | {
      status: "retry"
      retryUploads: Array<Pick<IdentityUpload, "documentType" | "side">>
      message: string
      assessments: DocumentAssessment[]
    }
  | {
      status: "reset"
      message: string
      assessments: DocumentAssessment[]
    }

const MODEL = "gemini-3.6-flash" as const
const PASS_CONFIDENCE = 78
const RESET_CONFIDENCE = 25
const MAX_IMAGE_BYTES = 7 * 1024 * 1024

const REFERENCE_PATHS: Record<
  IdentityDocumentType,
  Record<IdentityDocumentSide, string>
> = {
  student_id: {
    front: "Student Id Exammple/IMG_20260802_000702.jpg",
    back: "Student Id Exammple/IMG_20260802_000650.jpg",
  },
  national_id: {
    front: "National ID example/IMG_20260801_234938.jpg",
    back: "National ID example/IMG_20260801_234905.jpg",
  },
  drivers_license: {
    front: "Drivers License Example/IMG_20260801_234626.jpg",
    back: "Drivers License Example/IMG_20260801_234839.jpg",
  },
}

const documentLabels: Record<IdentityDocumentType, string> = {
  national_id: "Philippine National ID",
  student_id: "Student ID",
  drivers_license: "Driver's License",
}

const referenceCache = new Map<string, Promise<{ mimeType: string; data: string }>>()

function confidence(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 0
}

function sideAssessment(value: unknown): SideAssessment {
  const source = (value ?? {}) as Record<string, unknown>
  return {
    confidence: confidence(source.confidence),
    documentPresent: Boolean(source.documentPresent),
    correctSide: Boolean(source.correctSide),
    clearEnough: Boolean(source.clearEnough),
    visuallyPlausible: Boolean(source.visuallyPlausible),
    issue: String(source.issue ?? "The image could not be verified."),
  }
}

function parseAssessment(
  documentType: IdentityDocumentType,
  text: string,
): DocumentAssessment {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Gemini did not return a verification result. Please try again.")
  let source: Record<string, unknown>
  try {
    source = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    throw new Error("Gemini returned an unreadable verification result. Please try again.")
  }
  return {
    documentType,
    overallConfidence: confidence(source.overallConfidence),
    front: sideAssessment(source.front),
    back: sideAssessment(source.back),
    reason: String(source.reason ?? "The document needs another review."),
  }
}

function mimeTypeFor(path: string) {
  return path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
}

function bytesToBase64(bytes: Uint8Array) {
  let result = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(result)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      console.error("❌ [Image Base64] Failed to read file:", file.name)
      reject(new Error(`Could not read image file ${file.name}`))
    }
    reader.onload = () => {
      const value = String(reader.result ?? "")
      const comma = value.indexOf(",")
      const base64 = comma === -1 ? value : value.slice(comma + 1)
      console.log(`📷 [Image Base64] Converted ${file.name} (${file.size} bytes, ${file.type || "image/jpeg"})`)
      resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}

async function referenceImage(
  role: AppRole,
  documentType: IdentityDocumentType,
  side: IdentityDocumentSide,
): Promise<{ mimeType: string; data: string } | null> {
  const path = REFERENCE_PATHS[documentType][side]
  const existing = referenceCache.get(path)
  if (existing) {
    console.log(`🖼️ [Reference Image] Loaded from cache for ${documentType} (${side})`)
    return existing
  }

  console.log(`🖼️ [Reference Image] Fetching reference layout from Firebase Storage: ${path}`)
  const request = getDownloadURL(
    storageRef(getStorage(getScopedFirebase(role).app), path),
  )
    .then(async (url) => {
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`⚠️ [Reference Image] Reference HTTP ${response.status} for ${path}`)
        return null
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        console.warn(`⚠️ [Reference Image] Reference image exceeds size limit for ${path}`)
        return null
      }
      console.log(`✅ [Reference Image] Successfully loaded reference for ${documentType} (${side})`)
      return { mimeType: mimeTypeFor(path), data: bytesToBase64(bytes) }
    })
    .catch((err) => {
      console.warn(`⚠️ [Reference Image] Storage read bypassed for ${path}:`, err?.message || err)
      referenceCache.delete(path)
      return null
    })
  referenceCache.set(path, request)
  return request
}

function assessmentPrompt(documentType: IdentityDocumentType) {
  const label = documentLabels[documentType]
  return `You are PASADA's document-quality screener. Review a submitted ${label}.

This is a visual screening only, not an official government authenticity decision. Do not output ID numbers, birth dates, addresses, or other document data.

If reference images are included, they are ONLY generic examples of the expected document type and front/back layout. They do NOT belong to the applicant. Use them as a loose visual template for document category, card structure, fields, and expected front/back distinction.

CRITICAL: Never compare the submitted ID's name, face, photo, signature, ID number, address, dates, barcode/QR content, or any other personal detail to a reference example. Different people will naturally have entirely different personal details. Do not fail, lower confidence, or request a retake because those details differ. Do not attempt to match the submitted ID to the PASADA display name.

Check that the submitted FRONT and BACK images:
- are actual, unedited-looking ${label} images, not random photos, screenshots, blank paper, or unrelated cards;
- show the complete document with readable text and adequate light;
- have the correct front/back orientation;
- visually follow the expected Philippine ${label} layout and features, allowing normal variations between legitimate issues, institutions, and card designs;
- are assessed only from their document type, layout, visibility, and obvious visual integrity—not identity matching.

Return ONLY valid JSON in exactly this shape:
{
  "overallConfidence": 0,
  "front": {
    "confidence": 0,
    "documentPresent": true,
    "correctSide": true,
    "clearEnough": true,
    "visuallyPlausible": true,
    "issue": "short explanation without personal data"
  },
  "back": {
    "confidence": 0,
    "documentPresent": true,
    "correctSide": true,
    "clearEnough": true,
    "visuallyPlausible": true,
    "issue": "short explanation without personal data"
  },
  "reason": "short summary without personal data"
}

Use very low confidence (0-24) for random, non-document, spoofed, or fundamentally unrelated images. Use moderate confidence for real but dim, cropped, blurry, or wrong-side images. Approve only if every image is clear, correct, and visually plausible. A different name or photo from a reference image is expected and is never a reason to fail.`
}

async function assessDocument({
  role,
  documentType,
  uploads,
}: {
  role: AppRole
  documentType: IdentityDocumentType
  uploads: IdentityUpload[]
}) {
  console.log(`🤖 [Gemini Vision] Assessing document type: ${documentType}...`)
  const apiKey = import.meta.env.VITE_GOOGLE_AI_API_KEY
  if (!apiKey) {
    console.error("❌ [Gemini Vision] Missing VITE_GOOGLE_AI_API_KEY environment variable")
    throw new Error("Gemini verification is not configured. Add VITE_GOOGLE_AI_API_KEY to the environment.")
  }
  const front = uploads.find((upload) => upload.side === "front")
  const back = uploads.find((upload) => upload.side === "back")
  if (!front || !back) {
    console.error(`❌ [Gemini Vision] Missing front or back for ${documentType}`)
    throw new Error(`Upload the front and back of the ${documentLabels[documentType]}.`)
  }
  if ([front.file, back.file].some((file) => file.size > MAX_IMAGE_BYTES)) {
    console.error(`❌ [Gemini Vision] Image size > 7MB for ${documentType}`)
    throw new Error("Each ID image must be 7 MB or smaller.")
  }

  const [referenceFront, referenceBack, submittedFront, submittedBack] =
    await Promise.all([
      referenceImage(role, documentType, "front"),
      referenceImage(role, documentType, "back"),
      fileToBase64(front.file),
      fileToBase64(back.file),
    ])

  const promptParts: any[] = [{ text: assessmentPrompt(documentType) }]
  if (referenceFront) {
    promptParts.push({ text: "REFERENCE FRONT (layout only):" }, { inlineData: referenceFront })
  }
  if (referenceBack) {
    promptParts.push({ text: "REFERENCE BACK (layout only):" }, { inlineData: referenceBack })
  }
  promptParts.push(
    { text: "SUBMITTED FRONT:" },
    {
      inlineData: {
        mimeType: front.file.type || "image/jpeg",
        data: submittedFront,
      },
    },
    { text: "SUBMITTED BACK:" },
    {
      inlineData: {
        mimeType: back.file.type || "image/jpeg",
        data: submittedBack,
      },
    },
  )

  console.log(`📡 [Gemini Vision] Sending request to Gemini 1.5/3.6 Flash for ${documentType}`)
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: promptParts,
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  )
  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    console.error(`❌ [Gemini Vision] HTTP ${response.status} error for ${documentType}:`, errText)
    throw new Error("Gemini could not verify the ID right now. Please try again in a moment.")
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
  if (!text) {
    console.error(`❌ [Gemini Vision] Empty response returned for ${documentType}`)
    throw new Error("Gemini did not return a document assessment. Please try again.")
  }
  
  const assessment = parseAssessment(documentType, text)
  console.log(`📊 [Gemini Vision] Assessment result for ${documentType}:`, assessment)
  return assessment
}

export async function verifyIdentityDocuments({
  role,
  displayName,
  uploads,
}: {
  role: AppRole
  displayName: string
  uploads: IdentityUpload[]
}): Promise<VerificationOutcome> {
  console.log(`🚀 [AI Identity Check] Initiating verification for role: "${role}", displayName: "${displayName}"`)
  console.log(`📄 [AI Identity Check] Uploaded files (${uploads.length}):`, uploads.map((u) => `${u.documentType}:${u.side} (${u.file.name})`))

  const requiredTypes: IdentityDocumentType[] =
    role === "passenger"
      ? [uploads[0]?.documentType].filter(Boolean) as IdentityDocumentType[]
      : ["drivers_license"]
  if (!displayName.trim() || displayName.trim().length < 2) {
    console.warn("⚠️ [AI Identity Check] Display name missing or invalid")
    throw new Error("Enter your display name before verifying your ID.")
  }
  if (
    requiredTypes.length !== 1 ||
    requiredTypes.some(
      (type) => !uploads.some((upload) => upload.documentType === type && upload.side === "front") || !uploads.some((upload) => upload.documentType === type && upload.side === "back"),
    )
  ) {
    console.warn("⚠️ [AI Identity Check] Incomplete required ID slots uploaded")
    throw new Error("Upload every required front and back ID image before verification.")
  }

  const assessments = await Promise.all(
    requiredTypes.map((documentType) =>
      assessDocument({
        role,
        documentType,
        uploads: uploads.filter((upload) => upload.documentType === documentType),
      }),
    ),
  )
  const allSides = assessments.flatMap((assessment) => [assessment.front, assessment.back])
  const randomOrSpoofed = allSides.some(
    (side) => side.confidence <= RESET_CONFIDENCE || !side.documentPresent,
  )
  if (randomOrSpoofed) {
    console.warn("⛔ [AI Identity Check] OUTCOME: RESET (Random/Spoofed or Non-document detected)")
    return {
      status: "reset",
      message:
        role === "passenger"
          ? "These uploads do not look like the selected ID. For your security, select both sides again using clear photos of the original ID."
          : "These uploads do not look like the required driver's license. For your security, select both sides again using clear photos of the original ID.",
      assessments,
    }
  }

  const retryUploads: Array<Pick<IdentityUpload, "documentType" | "side">> = []
  for (const assessment of assessments) {
    for (const side of ["front", "back"] as const) {
      const result = assessment[side]
      if (
        result.confidence < PASS_CONFIDENCE ||
        !result.correctSide ||
        !result.clearEnough ||
        !result.visuallyPlausible
      ) {
        retryUploads.push({ documentType: assessment.documentType, side })
      }
    }
  }
  if (retryUploads.length) {
    const uniqueRetries = retryUploads.filter(
      (upload, index, all) =>
        all.findIndex(
          (other) =>
            other.documentType === upload.documentType && other.side === upload.side,
        ) === index,
    )
    console.warn("🔄 [AI Identity Check] OUTCOME: RETRY (Clarification needed for specific sides):", uniqueRetries)
    return {
      status: "retry",
      retryUploads: uniqueRetries,
      message: "One or more ID sides need a clearer retake. Only the marked image slots were cleared.",
      assessments,
    }
  }

  const approvedUploads = uploads.filter((upload) =>
    requiredTypes.includes(upload.documentType),
  )
  const avgConf = Math.round(
    allSides.reduce((sum, side) => sum + side.confidence, 0) / allSides.length,
  )
  console.log(`✅ [AI Identity Check] OUTCOME: APPROVED (Average confidence: ${avgConf}%)`)
  return {
    status: "approved",
    approval: {
      approved: true,
      role,
      verifiedDisplayName: displayName.trim(),
      approvedAt: Date.now(),
      model: MODEL,
      averageConfidence: avgConf,
      uploads: approvedUploads,
    },
    message: "ID visual check passed. You can complete your PASADA registration.",
    assessments,
  }
}

export async function storeApprovedIdentityDocuments(
  role: AppRole,
  uid: string,
  verification: ApprovedIdentityVerification,
): Promise<StoredIdentityVerification> {
  console.log(`☁️ [Firebase Storage] Uploading ${verification.uploads.length} approved identity document(s) for UID: ${uid}`)
  const storage = getStorage(getScopedFirebase(role).app)
  const uploadedPaths: string[] = []
  try {
    const documents: StoredIdentityVerification["documents"] = []
    for (const upload of verification.uploads) {
      const safeName = upload.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      const path = `identity-verifications/${role}/${uid}/${upload.documentType}-${upload.side}-${Date.now()}-${safeName}`
      console.log(`⬆️ [Firebase Storage] Uploading: ${path}`)
      await uploadBytes(storageRef(storage, path), upload.file, {
        contentType: upload.file.type || "image/jpeg",
        customMetadata: {
          verificationStatus: "approved",
          documentType: upload.documentType,
          side: upload.side,
        },
      })
      uploadedPaths.push(path)
      documents.push({
        documentType: upload.documentType,
        side: upload.side,
        storagePath: path,
        contentType: upload.file.type || "image/jpeg",
        size: upload.file.size,
      })
    }
    console.log(`✅ [Firebase Storage] All ${documents.length} approved documents successfully stored in Firebase Storage!`)
    return {
      approved: true,
      role: verification.role,
      approvedAt: verification.approvedAt,
      model: verification.model,
      averageConfidence: verification.averageConfidence,
      documents,
    }
  } catch (error) {
    console.error("❌ [Firebase Storage] Storage upload failed. Rolling back uploaded files...", error)
    await Promise.all(
      uploadedPaths.map((path) => deleteObject(storageRef(storage, path)).catch(() => undefined)),
    )
    throw error
  }
}

export async function removeStoredIdentityDocuments(
  role: AppRole,
  verification?: StoredIdentityVerification,
) {
  if (!verification) return
  const storage = getStorage(getScopedFirebase(role).app)
  await Promise.all(
    verification.documents.map((document) =>
      deleteObject(storageRef(storage, document.storagePath)).catch(() => undefined),
    ),
  )
}
