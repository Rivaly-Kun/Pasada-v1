# PASADA — Uber-style demo shell (Admin / Passenger / Driver)

## Context

The repo currently holds a scaffold only: `src/App.tsx` is a dot-grid cursor demo, and `src/index.css` is a bare `@import 'tailwindcss';`. The brief (`src/imports/pasted_text/pasada-ride-booking-1.md`) specifies PASADA, a tricycle ride-booking platform for Ormoc City with BCH/Paytaca/CashScript settlement, spanning three roles: Admin, Passenger, Driver.

Scope confirmed with the user: **all three sides, built as one demo shell with a role switcher**, each app lighter rather than one exhaustive app. The uploaded `src/imports/Group_5.png` is a palette swatch — red, blue, white — and is the color theme. Visual language is Uber-like: black/white structural base, heavy condensed-ish sans headings, map-first surfaces, big tap targets, bottom sheets.

Outcome: a navigable, front-end-only prototype (mocked data, no real blockchain calls) that communicates the full product — passenger booking with the six-seat buyout fare breakdown, driver online/request/ride flow, and admin fare + smart-contract configuration.

## Design direction

Invoke `Skill('make:aesthetic-stance')` and call `create_make_theme` before writing code; the notes below are the constraints the theme must satisfy, not a replacement for it.

- Tokens in `src/index.css` via Tailwind v4 `@theme`: `--color-pasada-red: #ef4b4b`, `--color-pasada-blue: #4a72b8`, plus a neutral ramp (near-black `#0b0b0c` ink, greys, white). Red = primary action / driver-side urgency / cancel-destructive is a *darker* red variant so the two never collide. Blue = escrow, blockchain, and admin chrome. White = surface.
- Uber-like structure: full-bleed dark map canvas, white bottom sheet with rounded top corners riding over it, one dominant black CTA bar pinned to the bottom, generous type scale, minimal chrome.
- Fonts: a Google Font pair chosen by the aesthetic pass, wired as a CSS2 `@import` at the very top of `src/index.css` (before `@import 'tailwindcss';` is not valid — Tailwind's import must stay first only if the font import precedes it; place **both** `@import` rules first, font import line 1).
- Map is a stylized SVG/CSS illustration (no map SDK): street grid, route polyline, pickup/destination pins, driver puck. Keep it in one reusable component.

## Files

New structure under `src/`:

- `src/App.tsx` — rewritten: holds the role switcher (Passenger / Driver / Admin), renders the phone-frame shell for the two mobile roles and a full-width desktop layout for Admin.
- `src/theme` — none; tokens live in `src/index.css`.
- `src/lib/fare.ts` — the fare engine. Implements the spec formula exactly: `seatCapacity 6`, `baseDistanceKm 2.5`, `baseFarePerSeat 10`, `additionalFarePerKmPerSeat 1.5`, `pasadaUpfrontFee 5`, `chargeableExtraKm = ceil(max(0, d - 2.5))`, night surcharge (₱5 within 2.5 km / ₱10 beyond, 9PM–5AM), special-trip ₱5, per-seat discount model (only verified eligible seats get 20% off). Money handled in integer centavos to avoid float drift; a `formatPeso` helper renders it. Returns a line-item breakdown array the UI renders directly, so passenger confirmation, driver request card, and admin preview all read from one source.
- `src/lib/mock.ts` — mock drivers, ride requests, wallet activity, transactions, users, ads.
- `src/lib/types.ts` — `Role`, `RideStatus`, `FareConfig`, `FareBreakdown`, `Driver`, `Ride`.
- `src/components/` — shared primitives: `PhoneFrame`, `MapCanvas`, `BottomSheet`, `BottomNav`, `StatTile`, `Sheet`/`Card`, `Pill`, `FareBreakdownList`, `EscrowBadge`.
- `src/apps/passenger/` — `PassengerApp.tsx` plus `HomeScreen` (wallet card with Top Up on the right, square Tricycle service button, ad carousel), `BookingScreen` (pickup/destination, passenger count 1–6, discount classifications, payment method cash vs BCH), `ConfirmScreen` (full breakdown + the exclusive-buyout disclaimer verbatim), `TrackingScreen` (driver en route, PIN confirm, complete + release), `PayScreen`, `ActivityScreen`, `SettingsScreen`.
- `src/apps/driver/` — `DriverApp.tsx` with map home + online/offline toggle, incoming request card (fare, payout, commission, escrow status, countdown to accept), active ride states (navigate → verify pickup → in transit → complete → settlement), plus Pay / Activity / Settings.
- `src/apps/admin/` — `AdminApp.tsx` with sidebar nav: Dashboard (stat tiles + recent blockchain transactions), Users (passenger/driver tables with approve/reject/suspend), Fare Configuration (editable values that feed a live fare preview through `src/lib/fare.ts`), Smart Contract Configuration (addresses, escrow/release/refund rules, expiry, network Chipnet/Mainnet, version list marked active).

State is local React state lifted to each app root — no router, no backend. Ride status transitions are driven by explicit buttons plus a couple of short `setTimeout`-based simulations (driver found, driver arriving), each cleaned up on unmount.

## Correctness details worth getting right

- The passenger count must never multiply the fare — billable seats are always 6. Surface this explicitly in the UI copy and keep the two numbers visually distinct.
- Cash bookings must not show escrow/blockchain-secured language; show the off-chain cash settlement steps instead. The ₱5 platform fee shows as a driver-settlement note.
- The ₱5 PASADA fee is always its own line, never folded into the driver fare.
- Fare config is versioned in the mock: a confirmed booking snapshots the config it used, and the admin editing rates afterward does not change it. Show this on the activity/receipt view.
- Add a short disclaimer in the admin fare section noting PASADA uses the ordinance's amounts but changes the distance origin from the City Stage to the passenger's pickup point.

## Verification

- The Vite dev server is already running; check the preview panel.
- Walk each role via the switcher: Passenger — book a ride within 2.5 km and confirm the total is ₱65.00, then a 3.2 km trip (₱74.00) and a 5.0 km trip (₱92.00), matching the spec's worked examples; toggle night trip and a senior discount and confirm the lines appear separately. Driver — go online, accept a request, run through to settlement. Admin — edit base fare and confirm the live preview updates, and confirm an already-confirmed passenger booking retains its old rate.
- Confirm layout at a narrow mobile width for the two phone apps and at desktop width for Admin.
- Run `pnpm build` once at the end to catch type errors across the new files.
