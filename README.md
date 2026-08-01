# PASADA 🛺⚡

> **Decentralized Tricycle Ride-Hailing & Non-Custodial Bitcoin Cash (BCH) Settlement Platform**  
> *tailored for Ormoc City, Leyte, Philippines*

---

## 📌 Overview

**PASADA** is a modern, web3-powered urban mobility platform designed to modernize tricycle transit in Ormoc City. By combining intuitive mobile-first web applications with non-custodial **Bitcoin Cash (BCH)** smart contract escrow and real-time blockchain settlement, PASADA connects passengers and registered tricycle drivers with transparent, instant, and low-fee transactions.

---

## ✨ Key Features

### 🛵 Passenger Application
- **Interactive Map & Fare Quoting**: Instant location pinning across Ormoc City landmarks (Ormoc City Public Market, Ormoc City Superdome, Brgy. Cogon, etc.).
- **6-Seat Buyout & Discount Rules**: Automated fare calculation supporting exclusive tricycle buyouts, senior/PWD/student discount classifications, night trip surcharges, and special route rates.
- **Embedded BCH Wallet**: Native browser wallet generation with CashAddr validation (`bchtest:`), WIF key recovery, and **10-second auto-syncing** via Fulcrum Electrum WSS nodes.
- **Live Driver Radar & Driver Rating**: Live driver approach tracking, PIN verification, and post-ride 5-star rating system with feedback tags (*Friendly driver*, *Safe driving*, *Clean tricycle*, *Punctual*).

### 🛺 Driver Application
- **Online Presence & Radar System**: One-tap online status toggle with pulsing radar active indicator and live geolocation streaming.
- **Dispatch Alert Sheets**: Real-time booking notification cards with countdown timers, pickup distance, trip distance, seat buyout breakdowns, and payout quotes.
- **Manual Arrival & Completion**: Manual **"Mark as Arrived & Complete Ride"** button ensuring drivers can complete trips seamlessly regardless of network latency.
- **Earnings & Wallet Sync**: Dedicated wallet tab displaying satoshis (`0.01035000 BCH · 1,035,000 sats`), PHP peso conversions, manual **"Sync wallet"** trigger, and historical ride payouts.

### ⚙️ Admin Console
- **Fare Configuration Management**: Dynamic control over base distance, base fare per seat, additional km rates, discount percentages, night surcharges, and platform fee parameters.
- **Platform Fee Wallet**: Dedicated Platform Admin BCH Chipnet address receiving automated on-chain fee commissions.
- **Metrics & Auditing**: City-wide ride counters, volume metrics (BCH vs. cash), and smart contract settlement logs.

---

## ⚡ Blockchain & Smart Contract Architecture

PASADA features a browser-native Bitcoin Cash transaction engine built on **Chipnet (BCH Testnet4)**:

```
                  ┌──────────────────────────────────────────────┐
                  │              Passenger Wallet                │
                  │   bchtest:qz9fhmj96grs9dmrdnau9ah07cf5...   │
                  └──────────────────────┬───────────────────────┘
                                         │
                                   Ride Settled
                                         │
             ┌───────────────────────────┴───────────────────────────┐
             │   Raw P2PKH Transaction (@bitauth/libauth signed)     │
             │   BIP-0143 Digest + ECDSA SIGHASH_ALL | SIGHASH_FORKID   │
             └─────────────┬───────────────────────────┬─────────────┘
                           │                           │
             ┌─────────────▼─────────────┐ ┌───────────▼─────────────┐
             │       Driver Payout       │ │   Platform Commission   │
             │  (Driver's CashAddr)      │ │   (Admin's CashAddr)    │
             └───────────────────────────┘ └─────────────────────────┘
```

- **UTXO Querying & Broadcasting**: Direct WSS connection to public Fulcrum Electrum nodes (`wss://chipnet.bch.ninja:50004`, `wss://chipnet.imaginary.cash:50004`).
- **Signature & Digest Construction**: Uses `@bitauth/libauth` for secp256k1 ECDSA DER signatures with `SIGHASH_ALL | SIGHASH_FORKID` (`0x41`).
- **Automated On-Chain Payout Split**: When a ride is completed, a raw transaction is built, signed locally, and broadcasted to send `driverPayoutSats` to the driver's CashAddr and `platformFeeSats` to the platform admin CashAddr.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, Vite 8, TypeScript 5.7
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`), Google Fonts (Outfit, Inter)
- **Blockchain**: `@bitauth/libauth`, Electrum WSS (`@electrum-cash/network`), Web Crypto API (SHA-256 P2PKH scripthash)
- **Realtime State & Auth**: Firebase Realtime Database, Firebase Authentication

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20.0.0 or higher
- **pnpm** or **npm**

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/pasada.git
   cd pasada
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory (or copy `.env.example`):
   ```env
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=pasada-6a6a9.firebaseapp.com
   VITE_FIREBASE_DATABASE_URL=https://pasada-6a6a9-default-rtdb.asia-southeast1.firebasedatabase.app
   VITE_FIREBASE_PROJECT_ID=pasada-6a6a9
   VITE_FIREBASE_STORAGE_BUCKET=pasada-6a6a9.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=508714010986
   VITE_FIREBASE_APP_ID=1:508714010986:web:0128378e2b34bde001bd13
   ```

4. **Start the Development Server**:
   ```bash
   npm run dev
   ```

5. **Open Applications**:
   - Preview Panel / Local URL: `http://localhost:8443` (or Vite assigned port).
   - Use the top role switcher bar to toggle between **Passenger App**, **Driver App**, and **Admin Console**.

---

## 🔐 BCH wallet connection modes

Account signup records one `walletMode` value in the user profile and role wallet:

- `paytaca_walletconnect` — creates a WalletConnect v2 `bch:bchtest` session with Paytaca, requests its native BCH signing capabilities, and verifies the selected address through a user-approved `bch_signMessage` request.
- `local_wallet` — generates a new P2PKH Chipnet wallet in the browser. Its key remains browser-local; Firebase receives only the address and public key.

Paytaca connectivity requires a WalletConnect/Reown project ID. Add the public client identifier to `.env`:

```text
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

PASADA does not implement Paytaca as an OAuth provider and never requests, receives, transmits, logs, or stores Paytaca recovery phrases, WIFs, or private keys.

## 🧪 Testing BCH Faucet & Funding

To test live BCH transactions on Chipnet:
1. Copy the passenger's CashAddr (e.g. `bchtest:qz9fhmj96grs9dmrdnau9ah07cf5tepngct52n99a4`).
2. Request testnet funds from the Paytaca Chipnet Faucet: [faucet.paytaca.com](https://faucet.paytaca.com/).
3. Click **Sync wallet** in the Passenger App to update the live satoshi balance.

---

## 📜 Project Structure

```
PasadaAdmin/
├── src/
│   ├── apps/
│   │   ├── admin/          # Admin Console dashboard & fare config
│   │   ├── driver/         # Driver mobile app & radar scanner
│   │   └── passenger/      # Passenger booking, wallet & ratings
│   ├── components/         # MapCanvas, PhoneFrame, UI components
│   ├── lib/
│   │   ├── auth.ts         # User auth, wallet persistence & non-blocking load
│   │   ├── bch-tx-builder.ts # Pure TypeScript BCH P2PKH transaction builder
│   │   ├── bch-wallet.ts   # Fulcrum WSS client & Web Crypto SHA-256 scripthash
│   │   ├── fare.ts         # Ormoc City fare calculation & satoshi conversion
│   │   ├── firebase.ts     # Firebase App & Auth role-scoped instances
│   │   ├── geo.ts          # Ormoc City landmarks & distance math
│   │   ├── platform-service.ts # Admin platform ledger & fee account
│   │   └── ride-service.ts # Realtime Database dispatch, acceptance & completion
│   ├── App.tsx             # Main entry point with role switching shell
│   └── main.tsx            # React DOM root mounting & unhandled rejection handlers
├── package.json
├── vite.config.ts
└── README.md
```

---

## 📄 License

Distributed under the MIT License.
