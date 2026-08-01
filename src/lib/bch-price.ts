import { useEffect, useState } from "react"
import { PESO } from "./fare"

const BCH_PHP_ENDPOINT =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=php&include_last_updated_at=true"
const REFRESH_INTERVAL_MS = 60_000

export type BchPhpQuote = {
  phpPerBchCentavos: number
  fetchedAt: number
  source: "CoinGecko" | "Configured fallback"
}

let latestQuote: BchPhpQuote | null = null
let quoteRequest: Promise<BchPhpQuote> | null = null

async function requestBchPhpQuote(): Promise<BchPhpQuote> {
  const response = await fetch(BCH_PHP_ENDPOINT, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) throw new Error("BCH market-price request failed.")
  const data = (await response.json()) as {
    "bitcoin-cash"?: { php?: number }
  }
  const phpPerBch = Number(data["bitcoin-cash"]?.php)
  if (!Number.isFinite(phpPerBch) || phpPerBch <= 0) {
    throw new Error("BCH market-price response is invalid.")
  }
  return {
    phpPerBchCentavos: Math.round(phpPerBch * PESO),
    fetchedAt: Date.now(),
    source: "CoinGecko",
  }
}

async function getBchPhpQuote(): Promise<BchPhpQuote> {
  if (latestQuote && Date.now() - latestQuote.fetchedAt < REFRESH_INTERVAL_MS) {
    return latestQuote
  }
  if (!quoteRequest) {
    quoteRequest = requestBchPhpQuote()
      .then((quote) => {
        latestQuote = quote
        return quote
      })
      .finally(() => {
        quoteRequest = null
      })
  }
  return quoteRequest
}

/**
 * Supplies a refreshed BCH-to-PHP market estimate for wallet displays only.
 * Fare and escrow conversions keep using the published fare configuration.
 */
export function useBchPhpQuote(fallbackCentavos: number): BchPhpQuote {
  const [quote, setQuote] = useState<BchPhpQuote>(() =>
    latestQuote ?? {
      phpPerBchCentavos: fallbackCentavos,
      fetchedAt: Date.now(),
      source: "Configured fallback",
    },
  )

  useEffect(() => {
    let active = true
    const refresh = () => {
      void getBchPhpQuote()
        .then((nextQuote) => {
          if (active) setQuote(nextQuote)
        })
        .catch(() => {
          if (active) {
            setQuote((current) =>
              current.source === "CoinGecko"
                ? current
                : {
                    phpPerBchCentavos: fallbackCentavos,
                    fetchedAt: Date.now(),
                    source: "Configured fallback",
                  },
            )
          }
        })
    }
    refresh()
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [fallbackCentavos])

  return quote
}
