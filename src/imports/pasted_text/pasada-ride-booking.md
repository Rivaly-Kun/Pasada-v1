Here is a clearer, development-ready version of your prompt:

# PASADA: Smart Contract–Powered Ride-Booking Platform for Ormoc City

Design and develop **PASADA**, a ride-booking platform focused primarily on local transportation services in **Ormoc City**, particularly tricycles.

## Problem Statement

Traditional ride-hailing platforms depend heavily on centralized operators that control driver onboarding, fare calculation, payment collection, commissions, and payment settlement.

PASADA should connect passengers and drivers more directly while using **Bitcoin Cash, Paytaca, and CashScript smart contracts** to manage:

* Fare calculation
* Fare escrow
* Driver payments
* Platform commissions
* Payment splitting
* Refunds and cancellations
* Ride completion and payment release
* Service agreements between passengers and drivers

The platform may still have an administrator for user management and system configuration, but the actual payment and settlement rules should be enforced transparently through CashScript contracts.

## Main System Roles

PASADA will have three main sides:

1. Admin
2. Passenger
3. Driver

---

# 1. Admin Panel

The Admin Panel should focus only on managing users and configuring the platform’s fare and smart-contract rules.

## Admin Features

### User Management

The administrator should be able to:

* View registered passengers and drivers
* Review driver onboarding information
* Approve, reject, suspend, or reactivate driver accounts
* Suspend or reactivate passenger accounts
* View users’ linked Paytaca BCH addresses
* Review account and transaction activity

The administrator must not have direct access to users’ private keys or unrestricted control over their wallets.

### Fare Configuration

The administrator should be able to configure fare rules dynamically, including:

* Base fare
* Fare per kilometer
* Fare per minute
* Minimum fare
* Waiting-time fee
* Booking fee
* Platform commission
* Driver payout percentage
* Cancellation fee
* Refund percentage
* Additional location-based or service-based charges

The system should use these configurations when generating the fare and creating the corresponding CashScript transaction.

### Smart Contract Configuration

The Admin Panel should contain a dedicated **Smart Contract Configuration** section.

The administrator should be able to configure or manage:

* Passenger payment address
* Driver payment address
* Platform commission address
* Escrow conditions
* Payment-release conditions
* Cancellation and refund rules
* Ride expiration time
* Emergency refund conditions
* Multi-output transaction settings
* CashScript contract version
* Active or inactive contract configurations
* Network selection, such as BCH Chipnet or Mainnet

The administrator should link a Paytaca-generated BCH wallet address that will receive the platform’s commission through multi-output transactions.

Smart-contract configurations should be versioned and auditable. Existing rides should continue using the contract configuration that was active when the booking was created.

### Admin Dashboard

The dashboard should display:

* Total registered passengers
* Total registered drivers
* Active drivers
* Pending driver applications
* Completed rides
* Cancelled rides
* Total ride transaction value
* Total platform commissions
* Escrowed payments
* Failed or disputed transactions
* Recent blockchain transactions

---

# 2. Passenger Application

The Passenger Application should use a clean, mobile-first interface inspired by the simplicity of the GCash wallet experience.

## Registration and Onboarding

Passengers should be able to:

* Create an account
* Log in securely
* Complete a basic onboarding process
* Link their Paytaca BCH address
* View their BCH wallet balance
* Add funds through their linked Paytaca wallet
* Review and accept the platform’s payment and ride terms

The system should never request or store the passenger’s private key or seed phrase.

## Passenger Home Page

The first page after login should contain the following sections:

### Wallet Section

Display a wallet card showing:

* Available BCH balance
* Equivalent local currency value
* Linked Paytaca address
* Top Up button
* Send or Pay shortcut
* Recent wallet activity

The **Top Up** button should be placed on the right side of the wallet card.

### Ride Service Section

Below the wallet card, display a square service button for:

* Tricycle

The initial version of PASADA should focus on tricycle bookings in Ormoc City. The architecture may later support additional vehicle types.

When the passenger selects Tricycle, the booking interface should allow them to:

* Select a pickup location
* Select a destination
* View the estimated route
* View the calculated fare
* View the platform commission
* View the driver payout
* Confirm the booking
* Fund the smart-contract escrow
* Search for nearby available drivers

### Advertisement Section

The third section should contain a slideshow or carousel for:

* Local advertisements
* Platform announcements
* Promotions
* Safety reminders
* Partner establishments
* Ormoc transportation updates

## Passenger Bottom Navigation

The Passenger Application should have four navigation items:

1. **Home** – wallet overview, ride booking, and advertisements
2. **Pay** – wallet funding, QR payments, sending BCH, and transaction history
3. **Activity** – ride history, active bookings, cancelled rides, and payment records
4. **Settings** – profile, linked Paytaca address, security, notifications, and logout

## Passenger Booking Flow

The expected passenger flow is:

1. Register or log in.
2. Complete onboarding.
3. Link a Paytaca BCH address.
4. Ensure the wallet contains enough BCH.
5. Select Tricycle.
6. Set the pickup location and destination.
7. Review the fare breakdown.
8. Confirm the booking.
9. Deposit the fare into the CashScript escrow contract.
10. Wait for a driver to accept.
11. Track the driver on the map.
12. Confirm pickup using a PIN, QR code, or verification action.
13. Complete the ride.
14. Release the payment through the smart contract.
15. Rate the driver and review the transaction.

---

# 3. Driver Application

The Driver Application should focus on availability, booking acceptance, navigation, ride completion, and payment settlement.

## Driver Registration and Onboarding

Drivers should be able to:

* Create an account
* Log in securely
* Submit personal information
* Submit driver identification
* Submit vehicle information
* Upload required verification documents
* Link their Paytaca BCH address
* Review platform commission rules
* Accept the driver service agreement
* Wait for administrator approval

A driver must not be allowed to receive bookings until their account has been approved.

## Driver Home Page

After logging in, the driver should see a full-screen map.

The map interface should display:

* Driver’s current location
* Online or Offline toggle
* Nearby booking requests
* Pickup locations
* Passenger destinations when permitted
* Estimated fare
* Estimated distance to pickup
* Ride status
* Navigation controls

When the driver goes online, they should be able to receive nearby booking requests.

A booking request should show:

* Pickup location
* Destination
* Distance to the passenger
* Estimated trip distance
* Total passenger fare
* Driver payout
* Platform commission
* Payment escrow status
* Time remaining to accept

The driver should be able to accept or reject the request.

## Driver Bottom Navigation

The Driver Application should have four navigation items:

1. **Home** – map, online status, and incoming bookings
2. **Pay** – linked Paytaca wallet, earnings, withdrawals, QR payments, and transaction history
3. **Activity** – active ride, completed rides, cancelled rides, and earnings records
4. **Settings** – profile, vehicle information, linked BCH address, availability, security, and logout

## Driver Ride Flow

The expected driver flow is:

1. Register and complete driver onboarding.
2. Link a Paytaca BCH address.
3. Receive administrator approval.
4. Log in and go online.
5. Receive a nearby ride request.
6. Review the fare, route, commission, and payout.
7. Accept the booking.
8. Navigate to the passenger.
9. Verify passenger pickup.
10. Start the ride.
11. Navigate to the destination.
12. Mark the ride as completed.
13. Trigger the smart-contract settlement.
14. Receive the driver payout in the linked Paytaca wallet.
15. View the blockchain transaction record.

---

# CashScript Payment Architecture

Each ride should create or use a CashScript contract that handles the payment lifecycle.

## Required Payment Logic

The contract should support:

* Passenger fare deposit
* Escrow locking
* Driver payout
* Platform commission
* Multi-output settlement
* Passenger cancellation
* Driver cancellation
* Booking expiration
* Refunds
* Ride completion confirmation
* Dispute or emergency handling
* Protection against duplicate payment release

## Example Payment Flow

For a completed ride:

1. The passenger deposits the required BCH fare into escrow.
2. The driver accepts the booking.
3. The system records the active ride and contract transaction.
4. After the ride is completed and verified, the contract creates multiple outputs:

   * Driver payout sent to the driver’s Paytaca BCH address
   * Platform commission sent to the administrator’s configured BCH address
   * Any applicable refund returned to the passenger
5. The transaction ID is recorded in the platform database.

## Escrow Conditions

Payment should only be released when the configured conditions are satisfied, such as:

* Both passenger and driver confirm completion
* The passenger confirms completion
* A ride-completion PIN or QR code is verified
* A predefined timeout is reached
* An authorized dispute-resolution condition is executed

## Cancellation and Refund Rules

The contract should support different outcomes depending on the ride status:

* Cancellation before a driver accepts: full passenger refund
* Passenger cancellation after driver acceptance: configurable cancellation fee
* Driver cancellation: passenger refund
* Driver fails to arrive before expiration: passenger refund
* Ride completed: driver payout and platform commission
* Transaction expiration: funds returned according to the configured contract rules

---

# Paytaca Integration

Passengers, drivers, and the administrator should link their respective Paytaca BCH addresses.

Paytaca should be used for:

* BCH wallet connectivity
* Viewing balances
* Funding ride payments
* Signing transactions
* Receiving driver payouts
* Receiving platform commissions
* QR-based payments
* Viewing blockchain transaction records

PASADA must never store:

* Private keys
* Recovery phrases
* Seed phrases
* Unencrypted wallet credentials

All sensitive blockchain transactions should require wallet authorization or signing through the connected Paytaca wallet.

---

# Core Design Principles

The system should follow these principles:

* Mobile-first user experience
* Ormoc-focused transportation workflow
* Transparent fare calculation
* Non-custodial wallet integration
* Smart-contract-enforced payment settlement
* Clear driver and passenger onboarding
* Auditable commissions and payouts
* Secure handling of BCH addresses
* Real-time ride and payment status updates
* Simple interfaces suitable for everyday local commuters
* Separation between administrative configuration and user funds

The final output should include the complete user flow, page structure, dashboard components, database entities, API requirements, CashScript contract responsibilities, Paytaca integration points, ride state transitions, security requirements, and error-handling scenarios for the Admin, Passenger, and Driver applications.

Add the following section to the PASADA development prompt:

# Ormoc Tricycle Fare and Full-Seat Buyout Model

PASADA will use the fare values established under **Ormoc City Ordinance No. 121, Series of 2023**, but the platform will apply a modified distance-calculation model designed for direct passenger pickup.

The official ordinance calculates the fare radius from the Ormoc City Stage. In PASADA, the **passenger’s pickup point becomes the origin of the fare radius**.

This must be clearly identified as PASADA’s platform fare model because changing the official reference point from the City Stage to the passenger’s pickup location may require validation or approval from the appropriate Ormoc City authority.

## Core Fare Rules

PASADA initially supports an exclusive tricycle booking or **full-seat buyout**.

A franchised tricycle is treated as having a fixed capacity of:

```text
6 passenger seats
```

When a passenger books a tricycle, they reserve the entire vehicle. Therefore, the passenger pays for all six seats regardless of the actual number of passengers boarding.

The passenger may select the actual number of passengers from **1 to 6**, but this does not reduce the total fare.

The selected passenger count is used only for:

* Driver awareness
* Capacity validation
* Passenger manifest information
* Safety and booking records

## Base Fare

The base fare is:

```text
₱10.00 per seat
```

The base fare covers the first:

```text
2.5 kilometers
```

The 2.5-kilometer distance must be calculated from the passenger’s selected pickup point to the destination.

When the destination is within 2.5 kilometers of the pickup point:

```text
Per-seat fare = ₱10.00
Tricycle buyout fare = ₱10.00 × 6 seats
Tricycle buyout fare = ₱60.00
PASADA upfront fee = ₱5.00
Total passenger payment = ₱65.00
```

## Fare Beyond 2.5 Kilometers

After the first 2.5 kilometers, add:

```text
₱1.50 per seat for every succeeding kilometer
```

The recommended calculation is:

```text
Extra Distance = Maximum of 0 and Trip Distance − 2.5 km

Chargeable Extra Kilometers = Ceiling of Extra Distance

Per-Seat Fare = ₱10.00 + (Chargeable Extra Kilometers × ₱1.50)

Tricycle Buyout Fare = Per-Seat Fare × 6

Passenger Total = Tricycle Buyout Fare + PASADA Upfront Fee + Applicable Surcharges
```

Using `ceiling` means that any fraction of a succeeding kilometer is charged as one additional kilometer.

For example, a trip of 3.2 kilometers has:

```text
Extra Distance = 3.2 km − 2.5 km
Extra Distance = 0.7 km

Chargeable Extra Kilometers = 1

Per-Seat Fare = ₱10.00 + ₱1.50
Per-Seat Fare = ₱11.50

Tricycle Buyout Fare = ₱11.50 × 6
Tricycle Buyout Fare = ₱69.00

PASADA Upfront Fee = ₱5.00

Total Passenger Payment = ₱74.00
```

Another example for a 5-kilometer trip:

```text
Extra Distance = 5.0 km − 2.5 km
Extra Distance = 2.5 km

Chargeable Extra Kilometers = 3

Per-Seat Fare = ₱10.00 + (3 × ₱1.50)
Per-Seat Fare = ₱14.50

Tricycle Buyout Fare = ₱14.50 × 6
Tricycle Buyout Fare = ₱87.00

PASADA Upfront Fee = ₱5.00

Total Passenger Payment = ₱92.00
```

## Fare Formula

The fare engine should use the following logical formula:

```text
seatCapacity = 6
baseDistanceKm = 2.5
baseFarePerSeat = 10.00
additionalFarePerKmPerSeat = 1.50
pasadaUpfrontFee = 5.00

extraDistanceKm = max(0, tripDistanceKm - baseDistanceKm)

chargeableExtraKm = ceil(extraDistanceKm)

farePerSeat =
    baseFarePerSeat +
    (chargeableExtraKm × additionalFarePerKmPerSeat)

vehicleBuyoutFare =
    farePerSeat × seatCapacity

totalPassengerPayment =
    vehicleBuyoutFare +
    pasadaUpfrontFee +
    specialTripFee +
    nightTripFee -
    applicableDiscount
```

The calculation must use decimal-safe monetary arithmetic. Floating-point values should not be used directly for final monetary settlement.

## Full-Seat Buyout Rules

The following rules must apply:

* Every booking reserves the entire tricycle.
* The fixed billable capacity is six seats.
* A passenger booking alone still pays for six seats.
* Two to five passengers still pay the same full-buyout fare.
* Six passengers is the maximum allowed capacity.
* More than six passengers must not be accepted in one booking.
* The driver must see the declared passenger count before accepting the ride.
* The passenger count must not be used as the fare multiplier.
* The fixed six-seat capacity must be used as the fare multiplier.

Example:

```text
Actual passengers: 1
Billable seats: 6
Total within 2.5 km: ₱65.00
```

```text
Actual passengers: 4
Billable seats: 6
Total within 2.5 km: ₱65.00
```

```text
Actual passengers: 6
Billable seats: 6
Total within 2.5 km: ₱65.00
```

## PASADA Upfront Fee

PASADA charges a fixed upfront platform fee of:

```text
₱5.00 per booking
```

This fee must be displayed separately from the transportation fare.

The passenger’s fare breakdown should display:

```text
Base tricycle fare
Additional distance charge
Six-seat buyout multiplier
Special-trip surcharge
Night-trip surcharge
Discount, when applicable
PASADA upfront fee
Final amount payable
```

The ₱5.00 upfront fee must not be hidden inside the driver fare.

For wallet payments, this fee may be sent to PASADA’s configured BCH address as a separate transaction output.

## Special Trips

Based on the supplied Ormoc tariff, a special trip may receive an additional:

```text
₱5.00
```

A special trip may include travel outside the regular or usual route, including entry into private subdivisions or private properties.

The system should not automatically classify every exclusive booking as a special trip. Special-trip qualification should be based on a configurable rule approved by the platform administrator and relevant transport authority.

## Night-Trip Surcharge

Night trips occur between:

```text
9:00 PM and 5:00 AM
```

The fare engine should support the ordinance’s night-trip surcharge:

```text
Within 2.5 km: additional ₱5.00
Beyond 2.5 km: additional ₱10.00
```

In PASADA, the 2.5-kilometer determination will be based on the trip distance from the passenger’s pickup point unless the administrator configures another approved policy.

The passenger must see the night-trip charge before confirming the booking.

## Senior Citizen, PWD, and Student Discounts

The supplied tariff shows a discounted rate equivalent to approximately 20% off the regular fare for qualified senior citizens, persons with disabilities, and students.

PASADA should support verified discount eligibility, but the discount policy for a six-seat exclusive buyout must be configurable.

The system must not automatically apply a 20% discount to the entire six-seat vehicle unless that treatment has been approved. A safer implementation is to calculate the discount only for the number of verified eligible passengers while keeping the remaining billable seats at the regular rate.

Example configurable calculation:

```text
Eligible discounted seats = number of verified eligible passengers

Regular seats =
    6 − eligible discounted seats

Discounted seat fare =
    farePerSeat × 0.80

Vehicle fare =
    regular seats × farePerSeat
    +
    eligible discounted seats × discounted seat fare
```

The administrator should be able to configure:

* Whether discounts are enabled
* Eligible passenger classifications
* Required verification documents
* Maximum discounted seats
* Discount percentage
* Whether the PASADA fee is discountable
* Whether surcharges are discountable
* Discount validity and expiration

## Passenger Booking Interface

Before confirming a ride, the passenger should provide:

* Pickup location
* Destination
* Number of passengers, from 1 to 6
* Passenger discount classifications
* Payment method
* Special-trip information, when applicable

The confirmation screen should display:

```text
Trip distance
First 2.5 km base fare
Number of succeeding kilometers
Fare per seat
Fixed billable seats: 6
Declared passengers
Tricycle buyout subtotal
Special-trip surcharge
Night-trip surcharge
Passenger discount
PASADA upfront fee
Final payment amount
```

The interface must clearly state:

> This is an exclusive tricycle booking. The passenger reserves and pays for the full six-seat capacity regardless of the number of passengers boarding.

## Driver Booking Interface

The driver should see the following before accepting:

* Pickup location
* Destination
* Distance to pickup
* Estimated trip distance
* Number of passengers
* Fixed six-seat buyout fare
* Driver’s expected earnings
* PASADA fee or commission
* Applicable surcharges
* Passenger payment method
* Wallet escrow status
* Time remaining to accept

The driver must not be shown a misleading fare based only on the declared passenger count.

## Cash Payment

For cash payments:

1. The system calculates the same official fare breakdown.
2. The passenger confirms the booking.
3. The driver accepts the booking.
4. The passenger pays the driver in cash after the ride.
5. The driver confirms that the payment was received.
6. The passenger confirms that the cash payment was completed.
7. The system records the transaction as an off-chain cash payment.

Cash cannot be locked or automatically released by a CashScript contract because no BCH transaction occurs.

If PASADA intends to collect the ₱5.00 platform fee from cash bookings, the system must define a separate mechanism, such as:

* Driver prepaid platform balance
* Periodic driver settlement
* Deduction from future wallet earnings
* Separate BCH payment before accepting the booking

The system must not claim that a cash payment was secured through blockchain escrow.

## BCH Wallet Payment

For wallet payments, the passenger pays the BCH equivalent of the Philippine peso fare through the linked Paytaca wallet.

The wallet-payment process should be:

1. Calculate the final fare in Philippine pesos.
2. Retrieve the current configured PHP-to-BCH conversion rate.
3. Show the PHP amount and BCH equivalent.
4. Require the passenger to approve the transaction through Paytaca.
5. Lock the required BCH in the CashScript contract.
6. Record the funding transaction ID.
7. Allow the driver to accept only after escrow funding is confirmed.
8. Release the funds after valid ride completion.
9. Use multiple outputs to divide the payment.

Example settlement outputs:

```text
Output 1: Driver transportation earnings
Output 2: PASADA upfront fee or commission
Output 3: Passenger refund, when applicable
```

The smart contract should use BCH amounts in satoshis and must never use Philippine peso decimals directly.

## Admin Fare Configuration

The administrator should be able to configure:

```text
Fixed tricycle capacity
Base distance
Base fare per seat
Additional fare per kilometer
Distance-rounding method
PASADA upfront fee
Special-trip surcharge
Night-trip start time
Night-trip end time
Night surcharge within base distance
Night surcharge beyond base distance
Discount percentage
Eligible discount types
Cancellation charges
Driver payout rules
PHP-to-BCH rate source
Exchange-rate validity period
Minimum blockchain amount
Network and contract version
```

Default initial values:

```text
Fixed capacity: 6 seats
Base distance: 2.5 km
Base fare: ₱10.00 per seat
Additional fare: ₱1.50 per succeeding kilometer per seat
PASADA fee: ₱5.00
Special-trip surcharge: ₱5.00
Night surcharge within 2.5 km: ₱5.00
Night surcharge beyond 2.5 km: ₱10.00
Night period: 9:00 PM–5:00 AM
```

Fare configurations must be versioned. A booking must retain the exact fare configuration used when the passenger confirmed it, even if the administrator changes the rates afterward.

## Important Pricing Distinction

PASADA should not describe this calculation as an exact implementation of the ordinance without qualification.

The ordinance shown in the provided document uses the **Ormoc City Stage as the center of the 2.5-kilometer radius**. PASADA instead proposes using the **passenger’s pickup location as the starting point**.

Therefore, the system is:

```text
Using the ordinance’s fare amounts and surcharge structure,
but adapting the distance origin for an on-demand full-buyout service.
```

This distinction should be documented in the proposal, terms of service, fare configuration, and any presentation to the LGU or transport authority.
