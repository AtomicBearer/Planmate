# Chikkamagaluru pilot

Planmate includes 60 regional places, trails and experiences: 47 published destinations and 13 clearly labelled research leads. These are discovery choices, not a prefilled itinerary or an exhaustive inventory. No trip, dates, bookings or friends are created automatically.

## Browse and plan

Choose **Chikkamagaluru** in Discover. Common spelling variants entered when creating a trip resolve to the same city. Search also covers area, experience type and planning notes. Filter by circuit and research status. Kadur/Birur approach options, town visits, the hill circuit, Muthodi, Lakkavalli, Kemmanagundi, Mudigere, Kalasa and the western circuits remain distinct so distant places are not presented as nearby stops.

Each regional record retains its stable ID, source links, research date (15 November 2026), access caveat and planning note when proposed or scheduled. Research leads are labelled on cards and in details. Current permissions, prices, opening hours, crowd levels and January availability are not certified.

- The full Mullayanagiri–Baba Budangiri traverse is separate from the summit visit. Confirm route permission, guide advice and endpoint pickup. The reported bridge is unverified.
- Muthodi and Lakkavalli are different Bhadra safari areas. Use the reserve's authorized booking process; no self-drive forest or night-entry permission is implied.
- Lesser-known waterfalls and private trails need local access checks. The catalogue offers no invented night-forest route.
- Coordinates, Google place IDs and licensed photos remain empty where unverified. The existing connected Places search supplies real venue photos with attribution when configured; category illustrations are visibly labelled.
- Suggested time fields are editable placeholders. Choose actual durations, transfers and costs while building the day plan.

The source registry is in `shared/chikkamagaluru.js`. Key starting points:
[district places](https://chikkamagaluru.nic.in/en/places-of-interest/),
[ridge description](https://indiahikes.com/documented-trek/mullayanagiri-peak-trek),
[Bhadra booking](https://tickets.bhadratigerreserve.in/login/),
[forest booking portal](https://aranyavihaara.karnataka.gov.in/).
Source content does not itself grant permission to republish photographs.

## Train journeys

In **Our itinerary → Add train journey**, enter departure/arrival stations and separate dates. Train name/number and times can remain unknown; booking status is tentative, booked or cancelled. Overnight travel can start before the regional trip dates. For example, a manually entered 15 January departure and 16 January arrival can accompany regional days 16–19 January. No year or train is selected automatically.

Kadur is DRU and Birur is RRB. Select the Mumbai departure station from the actual ticket. Train data is manual, in IST, with no ticket booking, live delay or seat-availability integration. Private ticket identifiers are not requested. Train fares are outside activity estimates; actual paid fares can be recorded in Expenses.

Active journeys with known endpoint times are checked against each other and activities, including travel buffers. Unknown times cannot establish an overlap. Train changes require renewed plan review. Authors and the organizer can edit/remove journeys. Train forms use the existing private draft recovery and stale-edit review. Journeys appear in Itinerary, Today and the PDF, including dates outside the local stay.

## Share with two friends

Create a **shared** planning space, then choose **Invite friends** and share the private link yourself. Each friend enters a name in their own browser. Their membership is saved on that browser; the shared plan is stored on the server. Invitations expire after seven days and the organizer can replace/revoke them. Guest names are unverified. Keep browser storage for access; joining from a new device creates another membership.

The Netlify server adapter is described in [NETLIFY-SHARED.md](NETLIFY-SHARED.md). A folder-only upload cannot enable collaboration. Existing personal trips remain in their original browser; they are not automatically uploaded.

## Verification

`tests/regional-trains.test.js` checks research references, empty initial trips, aliases, overnight validation, activity conflicts and train edit permissions. `tests/netlify-api.test.js` exercises independent sessions, storage races, invitation expiry/revocation, removed members and provider references across function instances. The `regional-sharing` browser case uses the shared build and the Netlify request handler with a disposable store: three separate browsers join, share a train, propose a place, export a PDF and check narrow phone widths. These tests do not certify live Netlify storage, provider credentials or destination access.
