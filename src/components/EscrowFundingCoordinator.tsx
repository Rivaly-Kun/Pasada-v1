import { useEffect, useRef, useState } from "react"
import {
  hasLocalPasadaWalletKey,
  loadPasadaAccount,
  observePasadaAuth,
} from "../lib/auth"
import {
  fundRideEscrow,
  reconcileEscrowFunding,
  subscribeRideHistory,
} from "../lib/ride-service"
import type { LiveRide, PasadaAccount } from "../lib/types"

/**
 * Keeps passenger escrow funding alive while the dashboard is showing the
 * driver or admin view. It only acts when this browser holds the passenger's
 * local signing key; no secret is retrieved from Firebase.
 */
export default function EscrowFundingCoordinator() {
  const [passenger, setPassenger] = useState<PasadaAccount | null>(null)
  const ridesRef = useRef<LiveRide[]>([])
  const fundingRideIds = useRef(new Set<string>())
  const reconcilingRideIds = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    const unsubscribe = observePasadaAuth("passenger", (user) => {
      if (!user) {
        if (active) setPassenger(null)
        return
      }
      void loadPasadaAccount("passenger", user)
        .then((account) => {
          if (active) setPassenger(account)
        })
        .catch(() => {
          if (active) setPassenger(null)
        })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!passenger) return

    const processFundingRides = () => {
      for (const ride of ridesRef.current) {
        const canSignThisRide =
          !ride.demoMode &&
          ride.passengerId === passenger.uid &&
          Boolean(ride.escrow) &&
          hasLocalPasadaWalletKey(ride.passengerBchAddress)
        if (!canSignThisRide) continue

        if (
          ride.status === "funding" &&
          ride.paymentStatus === "funding" &&
          !fundingRideIds.current.has(ride.id)
        ) {
          fundingRideIds.current.add(ride.id)
          void fundRideEscrow(passenger.uid, ride.id)
            .catch(() => undefined)
            .finally(() => fundingRideIds.current.delete(ride.id))
        }

        // A lost broadcast response leaves the ride in this state. The
        // contract UTXO is checked periodically and is authoritative.
        if (
          ride.status === "funding" &&
          ride.paymentStatus === "funding_broadcasting" &&
          !reconcilingRideIds.current.has(ride.id)
        ) {
          reconcilingRideIds.current.add(ride.id)
          void reconcileEscrowFunding(passenger.uid, ride.id)
            .catch(() => undefined)
            .finally(() => reconcilingRideIds.current.delete(ride.id))
        }
      }
    }

    const unsubscribe = subscribeRideHistory(
      "passenger",
      passenger.uid,
      (rides) => {
        ridesRef.current = rides
        processFundingRides()
      },
    )
    const reconciliationTimer = window.setInterval(processFundingRides, 5_000)
    return () => {
      unsubscribe()
      window.clearInterval(reconciliationTimer)
      ridesRef.current = []
      fundingRideIds.current.clear()
      reconcilingRideIds.current.clear()
    }
  }, [passenger])

  return null
}
