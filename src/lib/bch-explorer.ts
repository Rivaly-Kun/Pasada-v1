const CHIPNET_BCH_EXPLORER = "https://chipnet.bch.ninja"

export function chipnetTransactionUrl(transactionId: string) {
  return `${CHIPNET_BCH_EXPLORER}/tx/${encodeURIComponent(transactionId)}`
}
