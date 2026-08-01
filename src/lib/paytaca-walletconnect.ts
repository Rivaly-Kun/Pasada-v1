import SignClient from "@walletconnect/sign-client"
import { normalizeAndValidateBchAddress } from "./bch-wallet"

const PAYTACA_CHAIN_ID = "bch:bchtest"

export type PaytacaWalletConnection = {
  topic: string
  address: string
  chainId: typeof PAYTACA_CHAIN_ID
}

let signClientPromise: Promise<SignClient> | null = null

function getProjectId() {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim()
  if (!projectId) {
    throw new Error(
      "WalletConnect is not configured. Add VITE_WALLETCONNECT_PROJECT_ID to your environment and restart the app.",
    )
  }
  return projectId
}

async function getSignClient(): Promise<SignClient> {
  if (!signClientPromise) {
    const url =
      typeof window === "undefined" ? "https://pasada.app" : window.location.origin
    signClientPromise = SignClient.init({
      projectId: getProjectId(),
      metadata: {
        name: "PASADA",
        description: "PASADA BCH wallet ownership verification",
        url,
        icons: [],
      },
    })
  }
  return signClientPromise
}

function accountToAddress(account: string) {
  const candidate = account.replace(/^bch:/, "")
  const validated = normalizeAndValidateBchAddress(candidate)
  if (!validated.valid) throw new Error("Paytaca returned an invalid BCH address.")
  if (!validated.address.startsWith("bchtest:")) {
    throw new Error("PASADA currently connects Paytaca on BCH Chipnet only.")
  }
  return validated.address
}

/**
 * Creates a Paytaca-compatible WalletConnect v2 session. The callback receives
 * the URI immediately so it can be displayed as a QR code while Paytaca asks
 * the wallet owner to approve the connection.
 */
export async function connectPaytacaWallet(
  onUri: (uri: string) => void,
): Promise<PaytacaWalletConnection> {
  const client = await getSignClient()
  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      bch: {
        chains: [PAYTACA_CHAIN_ID],
        methods: [
          "bch_getAddresses",
          "bch_signMessage",
          "bch_signTransaction",
        ],
        events: ["addressesChanged"],
      },
    },
  })
  if (!uri) throw new Error("WalletConnect did not return a pairing URI.")
  onUri(uri)

  const session = await approval()
  const account = session.namespaces.bch?.accounts?.[0]
  if (!account) throw new Error("Paytaca did not approve a BCH address.")

  return {
    topic: session.topic,
    address: accountToAddress(account),
    chainId: PAYTACA_CHAIN_ID,
  }
}

/** Requests a user-approved Bitcoin Signed Message signature from Paytaca. */
export async function requestPaytacaMessageSignature(
  connection: PaytacaWalletConnection,
  message: string,
): Promise<string> {
  const client = await getSignClient()
  const signature = await client.request({
    topic: connection.topic,
    chainId: connection.chainId,
    request: {
      method: "bch_signMessage",
      params: { message },
    },
  })
  if (typeof signature !== "string") {
    throw new Error("Paytaca returned an invalid ownership signature.")
  }
  return signature
}
