import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
  type UserCredential,
} from "firebase/auth"
import { get, ref, runTransaction, update } from "firebase/database"
import {
  fetchBchAddressInfo,
  generateBchWallet,
  normalizeAndValidateBchAddress,
  publicKeyForLocalBchWallet,
  subscribeAddressToWatchtower,
  validatePrivateKeyForBchAddress,
  verifyPublicKeyForBchAddress,
} from "./bch-wallet"
import { satoshisToCentavos } from "./fare"
import { getScopedFirebase, type AppRole } from "./firebase"
import {
  createReferralCode,
  deriveTokenAddress,
  normalizeReferralCode,
  queueReferralRewardForReferralSignup,
  resolveReferralCode,
} from "./cashtoken-service"
import {
  removeStoredIdentityDocuments,
  storeApprovedIdentityDocuments,
  type ApprovedIdentityVerification,
  type StoredIdentityVerification,
} from "./identity-verification"
import type { PasadaAccount, WalletMode } from "./types"

export type PasadaRegistration = {
  displayName: string
  email: string
  password: string
  bchAddress: string
  walletMode: WalletMode
  bchPublicKey: string
  identityVerification: ApprovedIdentityVerification
  /** Optional code supplied by a new passenger. */
  referredByCode?: string
  plate?: string
  vehicleBody?: string
}

function localWalletKey(address: string) {
  return `pasada_wif_${address.toLowerCase()}`
}

/** True only when this browser holds a signing key for the exact BCH address. */
export function hasLocalPasadaWalletKey(address: string): boolean {
  if (typeof window === "undefined") return false
  const validated = normalizeAndValidateBchAddress(address)
  return Boolean(
    validated.valid && localStorage.getItem(localWalletKey(validated.address)),
  )
}

/**
 * Reads and validates the browser-local signing key for an in-app wallet.
 * The key is returned only to local transaction code and is never uploaded.
 */
export function getLocalPasadaWalletSigningKey(address: string): string {
  if (typeof window === "undefined") {
    throw new Error("A BCH transaction can only be signed in a browser.")
  }
  const validatedAddress = normalizeAndValidateBchAddress(address)
  if (!validatedAddress.valid) throw new Error(validatedAddress.error)
  const privateKeyWif = localStorage.getItem(
    localWalletKey(validatedAddress.address),
  )
  if (!privateKeyWif) {
    throw new Error(
      "Open PASADA in the browser where this wallet was created to send BCH.",
    )
  }
  const validatedKey = validatePrivateKeyForBchAddress(
    privateKeyWif,
    validatedAddress.address,
  )
  if (!validatedKey.valid) throw new Error(validatedKey.error)
  return validatedKey.privateKeyWif
}

/**
 * Keeps the signing key in browser storage only. Firebase receives the public
 * address and wallet metadata, never a newly linked private key.
 */
export function linkPasadaWalletSigningKey(
  address: string,
  privateKeyWif: string,
): string {
  const validated = validatePrivateKeyForBchAddress(privateKeyWif, address)
  if (!validated.valid) throw new Error(validated.error)
  if (typeof window === "undefined") {
    throw new Error("A BCH signing key can only be linked in a browser.")
  }
  try {
    localStorage.setItem(
      localWalletKey(validated.address),
      validated.privateKeyWif,
    )
  } catch {
    throw new Error(
      "This browser blocked local wallet storage. Allow site storage and try again.",
    )
  }
  return validated.address
}

export function observePasadaAuth(
  role: AppRole,
  callback: (user: User | null) => void,
) {
  const scoped = getScopedFirebase(role)
  let cancelled = false
  let unsubscribe: () => void = () => undefined
  void scoped.persistenceReady.then(() => {
    if (!cancelled) unsubscribe = onAuthStateChanged(scoped.auth, callback)
  })
  return () => {
    cancelled = true
    unsubscribe()
  }
}

export async function loginPasada(
  role: AppRole,
  email: string,
  password: string,
) {
  const scoped = getScopedFirebase(role)
  await scoped.persistenceReady
  const credential = await signInWithEmailAndPassword(
    scoped.auth,
    email.trim(),
    password,
  )
  return credential.user
}

export async function registerPasada(role: AppRole, input: PasadaRegistration) {
  if (
    !input.identityVerification?.approved ||
    input.identityVerification.role !== role
  ) {
    throw new Error("Complete the AI identity verification before registering.")
  }
  if (Date.now() - input.identityVerification.approvedAt > 15 * 60 * 1000) {
    throw new Error(
      "Your identity check expired. Verify the ID images again before registering.",
    )
  }
  if (
    input.identityVerification.verifiedDisplayName !== input.displayName.trim()
  ) {
    throw new Error(
      "Your display name changed. Verify the ID images again before registering.",
    )
  }
  const validated = normalizeAndValidateBchAddress(input.bchAddress)
  if (!validated.valid) throw new Error(validated.error)
  const bchPublicKey = verifyPublicKeyForBchAddress(
    input.bchPublicKey,
    validated.address,
  )
  if (
    role === "driver" &&
    (!input.plate?.trim() || !input.vehicleBody?.trim())
  ) {
    throw new Error("Enter the driver plate number and vehicle description.")
  }

  let initialBalanceSats = 0
  try {
    initialBalanceSats = (await fetchBchAddressInfo(validated.address))
      .spendableSats
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("rejected this address")
    )
      throw error
  }

  const scoped = getScopedFirebase(role)
  await scoped.persistenceReady
  const email = input.email.trim().toLowerCase()
  const referredBy =
    role === "passenger" && input.referredByCode?.trim()
      ? await resolveReferralCode(input.referredByCode)
      : null
  let credential: UserCredential
  let createdAuthUser = false

  try {
    credential = await createUserWithEmailAndPassword(
      scoped.auth,
      email,
      input.password,
    )
    createdAuthUser = true
  } catch (createError) {
    const code = firebaseErrorCode(createError)
    if (code.includes("email-already-in-use")) {
      try {
        credential = await signInWithEmailAndPassword(
          scoped.auth,
          email,
          input.password,
        )
      } catch {
        throw new Error(
          "That email is already registered in Firebase. Please enter the correct password to attach your PASADA profile.",
        )
      }
    } else {
      throw createError
    }
  }

  const now = Date.now()
  const uid = credential.user.uid
  const roleCollection = role === "passenger" ? "passengers" : "drivers"
  const chipnetTokenAddress = deriveTokenAddress(validated.address)
  const referralCode =
    role === "passenger"
      ? createReferralCode(input.displayName, uid)
      : undefined
  let storedIdentityVerification: StoredIdentityVerification | undefined
  try {
    const [userSnapshot, roleSnapshot, balanceSnapshot] = await Promise.all([
      get(ref(scoped.database, `users/${uid}`)),
      get(ref(scoped.database, `${roleCollection}/${uid}`)),
      get(ref(scoped.database, `roleAccounts/${role}/${uid}/balance`)),
    ])
    storedIdentityVerification = await storeApprovedIdentityDocuments(
      role,
      uid,
      input.identityVerification,
    )
    await updateProfile(credential.user, {
      displayName: input.displayName.trim(),
    })
    const profile = {
      uid,
      firebaseUid: uid,
      displayName: input.displayName.trim(),
      email,
      role,
      bchAddress: validated.address,
      chipnetTokenAddress,
      walletMode: input.walletMode,
      bchPublicKey,
      identityVerification: storedIdentityVerification,
      accountStatus: "active",
      ...(role === "passenger"
        ? {
            referralCode,
            ...(referredBy
              ? {
                  referredByCode: normalizeReferralCode(
                    input.referredByCode ?? "",
                  ),
                  referredByUid: referredBy.uid,
                  referralQualified: false,
                }
              : {}),
          }
        : {}),
      ...(role === "driver"
        ? {
            plate: input.plate!.trim().toUpperCase(),
            vehicleBody: input.vehicleBody!.trim(),
            rating: Number(
              (roleSnapshot.val() as Record<string, unknown> | null)?.rating ??
                5,
            ),
            trips: Number(
              (roleSnapshot.val() as Record<string, unknown> | null)?.trips ??
                0,
            ),
          }
        : {}),
      createdAt: Number(
        (roleSnapshot.val() as Record<string, unknown> | null)?.createdAt ??
          now,
      ),
      updatedAt: now,
    }
    const writes: Record<string, unknown> = {
      [`users/${uid}/uid`]: uid,
      [`users/${uid}/email`]: email,
      [`users/${uid}/roles/${role}`]: true,
      [`users/${uid}/roleProfiles/${role}`]: profile,
      [`users/${uid}/updatedAt`]: now,
      [`${roleCollection}/${uid}`]: {
        ...roleSnapshot.val() as Record<string, unknown> | null,
        ...profile,
        ...(role === "driver"
          ? {
              online: Boolean(
                (roleSnapshot.val() as Record<string, unknown> | null)
                  ?.online ?? false,
              ),
              available: Boolean(
                (roleSnapshot.val() as Record<string, unknown> | null)
                  ?.available ?? false,
              ),
              assignedRideId:
                (roleSnapshot.val() as Record<string, unknown> | null)
                  ?.assignedRideId ?? null,
            }
          : {}),
      },
      [`roleWallets/${role}/${uid}`]: {
        uid,
        role,
        address: validated.address,
        tokenAddress: chipnetTokenAddress,
        network: "chipnet",
        mode: input.walletMode,
        source: input.walletMode,
        publicKey: bchPublicKey,
        chainSats: initialBalanceSats,
        createdAt: now,
        updatedAt: now,
      },
    }
    if (role === "passenger" && referralCode) {
      writes[`referralCodes/${referralCode}`] = {
        code: referralCode,
        uid,
        displayName: input.displayName.trim(),
        email,
        tokenAddress: chipnetTokenAddress,
        createdAt: now,
        updatedAt: now,
      }
    }
    if (!userSnapshot.exists()) writes[`users/${uid}/createdAt`] = now
    if (!balanceSnapshot.exists()) {
      writes[`roleAccounts/${role}/${uid}/balance`] = {
        availableSats: initialBalanceSats,
        chainSats: initialBalanceSats,
        lockedSats: 0,
        chainSource: "bch_watchtower",
        lastChainSyncAt: now,
        updatedAt: now,
        version: 1,
      }
    }
    await update(ref(scoped.database), writes)
    if (role === "passenger" && referredBy) {
      await queueReferralRewardForReferralSignup({
        passengerId: uid,
        passengerName: input.displayName.trim(),
        passengerEmail: email,
        referrer: {
          uid: referredBy.uid,
          displayName: referredBy.displayName,
          email: referredBy.email,
          tokenAddress: referredBy.tokenAddress,
          code: referredBy.code,
        },
      })
    }
    // Subscribe to Watchtower so it starts indexing this address on-chain immediately
    void subscribeAddressToWatchtower(validated.address)
  } catch (error) {
    await removeStoredIdentityDocuments(role, storedIdentityVerification)
    if (createdAuthUser)
      await deleteUser(credential.user).catch(() => undefined)
    else await signOut(scoped.auth).catch(() => undefined)
    throw error
  }
  return credential.user
}

export async function loadPasadaAccount(
  role: AppRole,
  user?: User,
): Promise<PasadaAccount> {
  const scoped = getScopedFirebase(role)
  const firebaseUser = user ?? scoped.auth.currentUser
  if (!firebaseUser)
    throw new Error(`Log in to the PASADA ${role} app to continue.`)
  const roleCollection = role === "passenger" ? "passengers" : "drivers"
  const [
    userSnapshot,
    roleSnapshot,
    walletSnapshot,
    balanceSnapshot,
    legacyWallet,
    legacyBalance,
  ] = await Promise.all([
    get(ref(scoped.database, `users/${firebaseUser.uid}`)),
    get(ref(scoped.database, `${roleCollection}/${firebaseUser.uid}`)),
    get(ref(scoped.database, `roleWallets/${role}/${firebaseUser.uid}`)),
    get(
      ref(scoped.database, `roleAccounts/${role}/${firebaseUser.uid}/balance`),
    ),
    get(ref(scoped.database, `wallets/${firebaseUser.uid}`)),
    get(ref(scoped.database, `accounts/${firebaseUser.uid}/balance`)),
  ])
  const userData = userSnapshot.val() as Record<string, unknown> | null
  const nestedProfiles = (userData?.roleProfiles ??
    {}) as Record<string, Record<string, unknown>>
  let roleData = (roleSnapshot.val() ??
    nestedProfiles[role]) as Record<string, unknown> | null
  const roles = (userData?.roles ?? {}) as Record<string, boolean>
  const accountStatus = String(
    roleData?.accountStatus ?? nestedProfiles[role]?.accountStatus ?? "active",
  )
  if (accountStatus === "pending") {
    throw new Error(
      "This PASADA account is waiting for administrator approval.",
    )
  }
  if (accountStatus === "suspended") {
    throw new Error(
      "This PASADA account has been suspended by an administrator.",
    )
  }
  if (accountStatus === "rejected") {
    throw new Error(
      "This PASADA registration was rejected by an administrator.",
    )
  }

  let wallet = (walletSnapshot.val() ??
    legacyWallet.val()) as Record<string, unknown> | null
  let balance = (balanceSnapshot.val() ??
    legacyBalance.val()) as Record<string, unknown> | null
  let address = String(wallet?.address ?? roleData?.bchAddress ?? "")
  let validated = normalizeAndValidateBchAddress(address)
  const savedWalletMode = String(
    wallet?.mode ??
      wallet?.source ??
      roleData?.walletMode ??
      roleData?.walletSource ??
      "",
  )
  if (
    savedWalletMode &&
    savedWalletMode !== "local_wallet" &&
    savedWalletMode !== "generated"
  ) {
    throw new Error(
      "This account has no PASADA in-app wallet profile. Re-register to create one in this browser.",
    )
  }
  let walletMode: WalletMode = "local_wallet"
  let bchPublicKey = String(wallet?.publicKey ?? roleData?.bchPublicKey ?? "")
  let backfilledLocalPublicKey = false
  if (
    !bchPublicKey &&
    walletMode === "local_wallet" &&
    validated.valid &&
    typeof window !== "undefined"
  ) {
    const localWif = localStorage.getItem(localWalletKey(validated.address))
    if (localWif) {
      try {
        bchPublicKey = publicKeyForLocalBchWallet(localWif, validated.address)
        backfilledLocalPublicKey = true
      } catch {
        // Leave legacy wallet data unchanged if its browser-local key is unavailable.
      }
    }
  }

  // Auto-provision profile and Chipnet wallet if account exists in Auth but lacks database profile
  if (!roleData || !roles[role] || !validated.valid) {
    const now = Date.now()
    const autoWallet = generateBchWallet()
    const autoAddress = autoWallet.address
    const autoTokenAddress = deriveTokenAddress(autoAddress)
    const autoPublicKey = publicKeyForLocalBchWallet(
      autoWallet.privateKeyWif,
      autoAddress,
    )
    const displayName =
      firebaseUser.displayName ||
      (firebaseUser.email ? firebaseUser.email.split("@")[0] : "") ||
      (role === "passenger" ? "Passenger" : "Driver")
    const email = firebaseUser.email || ""

    const profile = {
      uid: firebaseUser.uid,
      firebaseUid: firebaseUser.uid,
      displayName,
      email,
      role,
      bchAddress: autoAddress,
      chipnetTokenAddress: autoTokenAddress,
      walletMode: "local_wallet" as const,
      bchPublicKey: autoPublicKey,
      ...(role === "passenger"
        ? { referralCode: createReferralCode(displayName, firebaseUser.uid) }
        : {}),
      ...(role === "driver"
        ? {
            plate: "ORM-101",
            vehicleBody: "Bajaj RE",
            rating: 5,
            trips: 0,
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    }

    linkPasadaWalletSigningKey(autoWallet.address, autoWallet.privateKeyWif)

    const writes: Record<string, unknown> = {
      [`users/${firebaseUser.uid}/uid`]: firebaseUser.uid,
      [`users/${firebaseUser.uid}/email`]: email,
      [`users/${firebaseUser.uid}/roles/${role}`]: true,
      [`users/${firebaseUser.uid}/roleProfiles/${role}`]: profile,
      [`users/${firebaseUser.uid}/updatedAt`]: now,
      [`${roleCollection}/${firebaseUser.uid}`]: profile,
      [`roleWallets/${role}/${firebaseUser.uid}`]: {
        uid: firebaseUser.uid,
        role,
        address: autoAddress,
        tokenAddress: autoTokenAddress,
        network: "chipnet",
        mode: "local_wallet",
        source: "local_wallet",
        publicKey: autoPublicKey,
        chainSats: 0,
        createdAt: now,
        updatedAt: now,
      },
      [`roleAccounts/${role}/${firebaseUser.uid}/balance`]: {
        availableSats: 0,
        chainSats: 0,
        lockedSats: 0,
        chainSource: "bch_watchtower",
        lastChainSyncAt: now,
        updatedAt: now,
        version: 1,
      },
    }
    if (role === "passenger") {
      const autoReferralCode = createReferralCode(displayName, firebaseUser.uid)
      writes[`referralCodes/${autoReferralCode}`] = {
        code: autoReferralCode,
        uid: firebaseUser.uid,
        displayName,
        email: firebaseUser.email ?? "",
        tokenAddress: autoTokenAddress,
        createdAt: now,
        updatedAt: now,
      }
    }

    await update(ref(scoped.database), writes)
    roleData = profile
    address = autoAddress
    validated = { valid: true, address: autoAddress }
    bchPublicKey = autoPublicKey
    walletMode = "local_wallet"
  } else if (
    !walletSnapshot.exists() ||
    !balanceSnapshot.exists() ||
    backfilledLocalPublicKey
  ) {
    await update(ref(scoped.database), {
      ...(backfilledLocalPublicKey
        ? {
            [`users/${firebaseUser.uid}/roleProfiles/${role}/bchPublicKey`]:
              bchPublicKey,
            [`${roleCollection}/${firebaseUser.uid}/bchPublicKey`]:
              bchPublicKey,
          }
        : {}),
      [`roleWallets/${role}/${firebaseUser.uid}`]: {
        uid: firebaseUser.uid,
        role,
        address: validated.address,
        network: "chipnet",
        mode: walletMode,
        source: walletMode,
        publicKey: bchPublicKey,
        updatedAt: Date.now(),
      },
      [`roleAccounts/${role}/${firebaseUser.uid}/balance`]: {
        ...(balance ?? {}),
        availableSats: Number(balance?.availableSats ?? 0),
        lockedSats: Number(balance?.lockedSats ?? 0),
        updatedAt: Date.now(),
      },
    })
  }

  let availableSats = Number(balance?.availableSats ?? 0)
  const chipnetTokenAddress = deriveTokenAddress(validated.address)
  const referralCode =
    role === "passenger"
      ? String(
          roleData?.referralCode ??
            createReferralCode(
              String(
                roleData?.displayName ??
                  firebaseUser.displayName ??
                  "Passenger",
              ),
              firebaseUser.uid,
            ),
        )
      : undefined
  if (
    String(roleData?.chipnetTokenAddress ?? "") !== chipnetTokenAddress ||
    (role === "passenger" && !roleData?.referralCode)
  ) {
    const now = Date.now()
    const publicTokenWrites: Record<string, unknown> = {
      [`users/${firebaseUser.uid}/roleProfiles/${role}/chipnetTokenAddress`]:
        chipnetTokenAddress,
      [`${roleCollection}/${firebaseUser.uid}/chipnetTokenAddress`]:
        chipnetTokenAddress,
      [`roleWallets/${role}/${firebaseUser.uid}/tokenAddress`]:
        chipnetTokenAddress,
    }
    if (role === "passenger" && referralCode) {
      publicTokenWrites[
        `users/${firebaseUser.uid}/roleProfiles/passenger/referralCode`
      ] = referralCode
      publicTokenWrites[`passengers/${firebaseUser.uid}/referralCode`] =
        referralCode
      publicTokenWrites[`referralCodes/${referralCode}`] = {
        code: referralCode,
        uid: firebaseUser.uid,
        displayName: String(
          roleData?.displayName ?? firebaseUser.displayName ?? "Passenger",
        ),
        email: firebaseUser.email ?? "",
        tokenAddress: chipnetTokenAddress,
        createdAt: Number(roleData?.createdAt ?? now),
        updatedAt: now,
      }
    }
    await update(ref(scoped.database), publicTokenWrites)
  }
  // Background balance refresh to keep live blockchain & database synchronized without delaying load
  void refreshPasadaWalletBalance(
    role,
    firebaseUser.uid,
    validated.address,
  ).catch(() => undefined)

  return {
    uid: firebaseUser.uid,
    firebaseUid: firebaseUser.uid,
    role,
    displayName: String(
      roleData?.displayName ?? firebaseUser.displayName ?? role,
    ),
    avatarDataUrl: String(roleData?.avatarDataUrl ?? "") || undefined,
    bchAddress: validated.address,
    chipnetTokenAddress,
    referralCode,
    referredByCode:
      role === "passenger"
        ? String(roleData?.referredByCode ?? "") || undefined
        : undefined,
    referredByUid:
      role === "passenger"
        ? String(roleData?.referredByUid ?? "") || undefined
        : undefined,
    bchPublicKey,
    walletMode,
    availableSats,
    availableCentavos: satoshisToCentavos(availableSats),
    authenticated: true,
    plate: role === "driver" ? String(roleData?.plate ?? "ORM-101") : undefined,
    vehicleBody:
      role === "driver"
        ? String(roleData?.vehicleBody ?? roleData?.body ?? "Bajaj RE")
        : undefined,
    rating: role === "driver" ? Number(roleData?.rating ?? 5) : undefined,
    trips: role === "driver" ? Number(roleData?.trips ?? 0) : undefined,
  }
}

/** Updates the public profile shown to the rider or driver in PASADA. */
export async function updatePasadaProfile(
  role: AppRole,
  uid: string,
  profile: { displayName: string avatarDataUrl?: string },
): Promise<void> {
  const displayName = profile.displayName.trim()
  if (displayName.length < 2) {
    throw new Error("Please enter a name with at least 2 characters.")
  }

  const scoped = getScopedFirebase(role)
  const roleCollection = role === "passenger" ? "passengers" : "drivers"
  const now = Date.now()
  const writes: Record<string, unknown> = {
    [`users/${uid}/displayName`]: displayName,
    [`users/${uid}/roleProfiles/${role}/displayName`]: displayName,
    [`users/${uid}/roleProfiles/${role}/updatedAt`]: now,
    [`${roleCollection}/${uid}/displayName`]: displayName,
    [`${roleCollection}/${uid}/updatedAt`]: now,
    [`users/${uid}/updatedAt`]: now,
  }

  if (role === "driver") {
    // Live dispatch reads `drivers/{uid}/name`, while the account profile uses
    // `displayName`; keep both in sync so a saved edit reaches new bookings.
    writes[`drivers/${uid}/name`] = displayName
  } else {
    const referralCodeSnapshot = await get(
      ref(scoped.database, `passengers/${uid}/referralCode`),
    )
    const referralCode = String(referralCodeSnapshot.val() ?? "")
    if (referralCode) {
      writes[`referralCodes/${referralCode}/displayName`] = displayName
      writes[`referralCodes/${referralCode}/updatedAt`] = now
    }
  }

  if (profile.avatarDataUrl !== undefined) {
    writes[`users/${uid}/roleProfiles/${role}/avatarDataUrl`] =
      profile.avatarDataUrl || null
    writes[`${roleCollection}/${uid}/avatarDataUrl`] =
      profile.avatarDataUrl || null
  }

  await update(ref(scoped.database), writes)
  if (scoped.auth.currentUser) {
    await updateProfile(scoped.auth.currentUser, { displayName })
  }
}

export async function refreshPasadaWalletBalance(
  role: AppRole,
  uid: string,
  bchAddress: string,
): Promise<number> {
  const info = await fetchBchAddressInfo(bchAddress)
  const scoped = getScopedFirebase(role)
  let availableSats = info.spendableSats
  const now = Date.now()
  await runTransaction(
    ref(scoped.database, `roleAccounts/${role}/${uid}/balance`),
    (current: Record<string, unknown> | null) => {
      // The app never adjusts wallet balances as an internal ledger. This is
      // the address balance reported by the BCH network, including mempool
      // transactions, so a refresh cannot overwrite a payout or a debit.
      availableSats = info.spendableSats
      return {
        ...(current ?? {}),
        availableSats,
        chainSats: info.spendableSats,
        lockedSats: 0,
        platformDebitsSats: 0,
        pendingRideCreditsSats: 0,
        chainSource: "bch_watchtower",
        lastChainSyncAt: now,
        updatedAt: now,
        version: Number(current?.version ?? 0) + 1,
      }
    },
  )
  await update(ref(scoped.database, `roleWallets/${role}/${uid}`), {
    address: info.address,
    chainSats: info.spendableSats,
    lastChainSyncAt: now,
    updatedAt: now,
  })
  return availableSats
}

export async function logoutPasada(role: AppRole) {
  await signOut(getScopedFirebase(role).auth)
}

export function friendlyAuthError(error: unknown): string {
  const code = firebaseErrorCode(error)
  if (
    code.includes("invalid-credential") ||
    code.includes("user-not-found") ||
    code.includes("wrong-password")
  ) {
    return "The email or password is incorrect."
  }
  if (code.includes("email-already-in-use")) {
    return "That email is already registered in Firebase. Enter its password to attach this PASADA profile."
  }
  if (code.includes("weak-password"))
    return "Use a password with at least 6 characters."
  if (code.includes("invalid-email")) return "Enter a valid email address."
  if (code.includes("network-request-failed"))
    return "Check your internet connection and try again."
  if (
    code.includes("PERMISSION_DENIED") ||
    code.includes("permission-denied")
  ) {
    return "Firebase Realtime Database permission denied. Please check your database rules in Firebase Console."
  }
  return error instanceof Error
    ? error.message
    : "Authentication failed. Please try again."
}

function firebaseErrorCode(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (typeof error === "object") {
    const err = error as Record<string, unknown>
    return String(err.code || err.message || err.toString() || "")
  }
  return ""
}
