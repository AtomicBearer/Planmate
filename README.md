# Planmate

Planmate turns a group's interests, availability and budgets into a plan everyone can review and explicitly agree to. It uses vanilla HTML/CSS/JavaScript and a Node server, preserving the cream, beige and brown scrapbook theme, sage/terracotta accents, handwritten headings, original travel artwork and reduced-motion support.

For your chosen **Netlify browser folder upload**, use [NETLIFY-UPLOAD.md](docs/NETLIFY-UPLOAD.md). Run `pnpm run build:netlify` to prepare `output/netlify`, or extract the prepared `output/planmate-netlify.zip`. This upload supports personal plans saved in the browser; shared invitations and private photo uploads require a server deployment. The full Node/shared source remains intact.

The default release works without external API keys and starts with no saved trip. Fonts, artwork and PDF assets are local. Guest invitations and shared planning run through Planmate's own Node server; personal profiles stay on each device and names are unverified. Live discovery/photos, Google map backgrounds, verified routes/accounts and event feeds are optional and remain off when unconfigured.

For GitHub-connected Node hosting, follow [Publish Planmate](docs/DEPLOYMENT.md). The included `render.yaml` uses paid compute with persistent disk; review its costs before deploying. GitHub Pages cannot run this backend, and a complete Netlify deployment needs a storage/runtime migration. `pnpm run check:launch` checks public configuration without printing credentials or making provider requests. The [API connection map](docs/API-CONNECTIONS.md) is retained for optional future integrations.

Source files are grouped into `public/` (pages/styles/browser scripts/assets), `shared/` (shared rules/catalogue), `server/` (API/services/storage), `docs/`, `scripts/` and `tests/`. The root `server.js` preserves launch commands; page URLs, invitations and the private root `data/` location remain compatible. Do not deploy `public/` alone for shared planning.

## Run locally

Use Node.js 24.13 or newer. The tested package manager and dependency versions are pinned in package.json and pnpm-lock.yaml.

Start commands load `.env` when present. Install dependencies explicitly before running checks; `pnpm-workspace.yaml` keeps script execution from silently rebuilding them when changing shells or CI environments.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open [Planmate](http://localhost:3000/login.html) or [the dashboard](http://localhost:3000/dashboard.html). By default the server listens on this computer only. `pnpm run start:lan` exposes the guest planning on your network; use the computer's reachable address in invitations. Public account deployment needs HTTPS and persistent disk; see [account, storage and recovery instructions](docs/ACCOUNT-STORAGE.md).

Directly opening public/dashboard.html provides browser-only planning with local plans, suggestions, scheduling, comments and expenses. Shared synchronization, account profiles and uploaded photos require the server. New visitors start without a trip. Create one, select a saved trip, or open a friend's invitation from **Join with an invitation**. No fictional members or generated itinerary are added.

## Plan together

1. **Dates & attendance:** the organizer proposes time windows; members answer all suitable options. Saving an empty response means none work. Unanswered members remain visible. The organizer chooses the date explicitly; no vote automatically confirms it. Affected scheduled activities must be resolved before changing trip dates.
2. **Plans that fit:** share interests, pace, an optional whole-trip per-person budget and must-have. Copying a profile into the form requires an explicit action; sharing to the trip requires a separate save. Profile preferences remain private. Recommendations show individual conflicts and missing costs/travel rather than assuming affordability.
3. **Explore places → Group ideas:** discover real provider places when configured, use starter picks or add a sourced manual suggestion. Interested/Maybe/Pass is one current response per member. Suggestions retain their own attributed, timestamped discussion, with author-only edit/delete.
4. **Our itinerary:** schedule day-by-day stops, including overnight activities, manual travel buffers and supplied cost estimates. Overlap detection includes adjacent days and travel. Linked map markers/cards, directions, sourced coordinates and optional connected route checks remain available. Drag or Move up/down previews timing and conflicts; applying and undoing are explicit. Pinned and published fixed-time activities retain their times.
5. **Dates & attendance:** attendance is separate from place votes. The organizer explicitly records an agreed version without locking later edits. Material changes request review and reconfirmation; cosmetic names and comments do not reconfirm attendance silently.
6. **Today's plan:** view the trip day in its stored timezone, the next stop, directions, group visit progress and remaining estimated budget. Past/empty days remain usable. Group visits do not imply personal attendance or actual payments.
7. **Actual expenses → Our scrapbook:** record actual bills and repayments separately from estimates, then add your own photos/captions to visited stops. Integer paise support exact equal/custom splits and settlement suggestions. Custom shares must equal the bill. Photos remain private to active trip members; visits with no uploaded image still appear as scrapbook cards.

The compact active-trip header emphasizes one next action for the viewing member or organizer. Planning, outing and memories have grouped navigation; mobile screens also have a labelled section picker. Recommendation formulas and lengthy checks are expandable; important reasons and conflicts stay visible.

## Unfinished work

Private form drafts track preferences, availability, comments and supported edit dialogs independently of focus. Multiple forms survive shared refreshes, failed saves and temporary connection failures. After reload, **Unfinished work on this browser → Restore/Discard** offers explicit recovery. A changed source requires review before saving; stale edits are never silently retried. Missing records or membership are explained. Successful saves and explicit discard clear the relevant draft. Focus, cursor, open discussions and scroll are retained when practical.

Drafts are scoped to the profile/account, trip and member, limited to 60 bounded records and expire after seven days. They contain allowlisted form values and a small user-planning baseline, never authentication credentials, uploaded files or provider details. Photo recovery restores the caption only; select the file and sharing consent again. If browser storage is blocked, unfinished work remains in memory and the page warns before closing. Shared submitted data still uses server revision checks.

## Accounts and storage

Google sign-in is server-verified when a client ID is configured. Guest names/emails are explicitly unverified. Account trips bind membership to the verified account, prevent duplicate memberships, support expiring/revocable invitations, organizer transfer and member removal. Historical attribution, expense balances and recorded versions survive departure. Private account profiles follow the account across devices and have independent stale-save protection. Legacy membership claims require verified sign-in, the original membership token, current revision and explicit consent; email matches never claim ownership.

Shared plans now persist in **SQLite**, with transactional revision checks and versioned import from the preserved original JSON. This release targets one Node process on one host with persistent disk. Own JPEG/PNG photos are decoded/re-encoded by Sharp, stripped of camera metadata and quota-limited. Provider photos are separate and transient. [ACCOUNT-STORAGE.md](docs/ACCOUNT-STORAGE.md) explains configuration, consent-based profile import, migrations, limits, backup, restore and rollback.

## Group needs and late nights

In **Dates & attendance**, select **Ends next day** when proposing a window such as Friday 22:00–Saturday 02:00. Each window lasts at most 24 hours. Adjacent selected windows merge across midnight; common availability and individual fit use the same civil clocks in the stored trip timezone. Choosing that final window includes its ending day in the trip. An unpolled portion of a stop or travel buffer is unknown; a declined covered window is a known conflict. Today includes ongoing stops from the previous night, and the PDF retains dates, timezone and overnight markers.

In **Plans that fit**, required activity types use supplied categories (Beach, Food, Nightlife, Sights, Outdoors or Event). They are separate from preferred interests and constrain each draft. Typed must-haves remain literal label/category/note searches for compatibility. A text match does **not** establish dietary suitability, accessibility or opening hours. Missing saved Google labels or categories remain unknown instead of becoming a fabricated unmet venue need; each member's known unmet requests remain visible.

Drafts can schedule flexible late-night stops and published fixed-time events across midnight while retaining pinned stops, actual event dates, overlap checks and adjacent-day travel buffers. Generation remains a bounded greedy search of the supplied candidates and selected start boundaries; it is not an exhaustive solver. A failed search does not prove infeasibility. Costs and travel remain supplied estimates, missing checks require acknowledgement, and only the organizer's explicit review/apply replaces the itinerary. Older generated drafts require regeneration against the new inputs; existing itineraries, responses and recorded confirmations are retained.

## Discovery scope and Goa pilot

The starter catalogue contains **110 places across 32 cities**, including 12 Goa picks. It is not exhaustive or evidence of current opening hours, ticket availability or prices. Original category illustrations are clearly labelled and never substituted as venue photos. A group may add any custom city or sourced place/event.

```sh
pnpm run check:pilot
pnpm run check:pilot -- --live
```

The first command reports configuration without billable calls. The opt-in live check searches Goa beaches, cafés and nightclubs using at most six search pages and one photo-reference lookup, without writing third-party data to disk. It reports duplicates, missing photos, addresses requiring review, partial/empty responses and provider errors. Review relevance visually in the Goa dashboard. Maps/routes and events need their respective configured services and trip-member checks. Empty results never prove that places/events do not exist.

Current local verification found Places, events, maps, routes and Google sign-in **unconfigured**. Provider and identity boundary tests use fixtures; no live city inventory, real Google sign-in or deployed HTTPS was verified. The adapters remain ready for real configuration. Live events remain deferred while unconfigured; no listings are fabricated. Shared refreshes reuse already loaded venue image nodes instead of spending another photo lookup, and newly discovered results appear before starter picks.

### Connect places and real photos

1. In Google Cloud, enable **Places API (New)**, configure billing, and create an API key restricted to that API (and your server's IP where appropriate). See the [setup instructions](https://developers.google.com/maps/documentation/places/web-service/get-api-key).
2. Copy `.env.example` to `.env`. Set `GOOGLE_PLACES_API_KEY` in `.env`; keep this file private. You can also supply server environment variables instead.
3. Start the configured server with Node.js 24.13 or newer:

    ```sh
    node --env-file=.env server.js
    ```

4. Open `http://localhost:3000/dashboard.html`, select a city, then choose **Find more places**. Use **Load more results** to continue provider discovery and **Show more places** to display more of the already loaded cards. Type a specific place, neighbourhood or activity and press Enter to search it.

The general city search covers beaches, cafés, restaurants, bakeries, seafood, clubs, bars, live music venues, attractions, museums, landmarks, markets, parks, waterfalls, trails and water sports. Each click requests at most three provider pages. Google's [Text Search documentation](https://developers.google.com/maps/documentation/places/web-service/text-search) currently describes up to 20 results per page and 60 per query, so the app combines specific searches rather than trying to request 200 from one query. Provider IDs remove duplicates across pages/topics. **150–200+ choices are possible when the provider has sufficient matching inventory; the count is not guaranteed for every city or category.** More topics can be added to `QUERIES` in `server/services/discovery.js`; the offline starter picks live in `shared/catalogue.js`.

Real photos come from [Place Photos](https://developers.google.com/maps/documentation/places/web-service/place-photos), with author credits and source links. Photos load only as their cards become visible. When a provider supplies no photo, or an image fails, the category illustration remains. There are no random stock photos presented as venue photos. Searches and photos can incur provider charges; use Google Cloud quotas/budgets and check the [current billing documentation](https://developers.google.com/maps/billing-and-pricing/overview).

Google discovery responses and photo references are transient, with `no-store` API responses. Persistent plans and bookmarks retain provider IDs and user planning choices instead of copying Google photos, addresses and descriptions. After reopening, choose **Saved places → Refresh saved place details** to retrieve current names/photos for saved or proposed Google venues, up to ten per click. An optional nickname keeps a readable user-authored name in a plan and its PDF export while offline. A bookmark keeps its original browsing city. Photo/search references expire after ten minutes; rerun the search for fresh photos. Review Google's [attribution, retention and public app requirements](https://developers.google.com/maps/documentation/places/web-service/policies) before a public launch.

### Export a shareable itinerary

Open **Itinerary → Export PDF**. Planmate downloads an A4 PDF with the cream, brown and sage palette, handwritten headings, original travel doodles, a whole-trip budget summary and a connected timeline for each day. Each stop includes its start/end time, overnight marker where applicable, area, travel buffer, estimated cost, notes and clickable map/venue links. Empty days remain visible as open planning space. Crowded days and long notes continue across numbered pages without being truncated.

The export snapshots the plan when clicked, so shared updates during generation cannot mix versions. Google places use the current details already available in the tab or the stored planning nickname; exporting does not request venue details or photos. The PDF contains the planned itinerary, not unscheduled ideas or account contact details, and notes/costs remain the group's estimates.

PDF libraries and embedded fonts load from local project files only when first needed. Export also works with browser-only plans; no API key, printing dialog or third-party PDF service is required. Supported fonts cover rupee amounts, accented names, Devanagari and monochrome emoji/symbols; other unsupported glyphs use a placeholder rather than failing the whole export. PDFs are static snapshots: export again after editing the itinerary.

### Connect city events

For local Indian inventory, set `EVENTS_FEED_URL` to an **authorised partner/organiser feed**, with `EVENTS_FEED_TOKEN` if it uses bearer authentication. This is an adapter contract, not an invented public BookMyShow or District endpoint: a partner integration must transform its results to the shape below. No ticketing site scraping is included.

Alternatively, set `TICKETMASTER_API_KEY` for the [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/). Its India inventory may not cover the city or shows you need. An empty result is not evidence that no events exist. If both are configured, the city feed takes precedence. Restart the server after changing configuration.

In **Discover → Events**, choose the dates and event type, enter a keyword such as “comedy” or an artist's name, then select **Find city events**. Dates initially match the trip; change them to explore upcoming dates. **Load more results** follows provider pages. To propose an event outside the trip, edit the trip dates first. Multi-day events can be planned on a day within their published range. A published start time is enforced on the starting date; unspecified times remain unspecified in discovery.

The city feed receives a server-side HTTPS GET with `city`, `q`, `from`, `to`, `type`, `page` (starting at 0), and `limit=40`. It should return filtered, fresh results and this JSON shape:

```json
{
  "events": [
    {
      "id": "organiser-stable-id",
      "name": "Example organiser listing (schema example only)",
      "city": "Goa",
      "venue": "Venue name",
      "date": "2026-10-10",
      "endDate": "2026-10-10",
      "time": "20:00",
      "type": "Comedy",
      "ticketUrl": "https://organiser.example/event",
      "image": "https://organiser.example/poster.jpg",
      "imageCredit": "Organiser / photographer",
      "description": "Programme information from the organiser",
      "status": "scheduled"
    }
  ],
  "nextPage": null
}
```

`id`, `name`, `city`, `date` and an HTTPS `ticketUrl` are required. Other fields are optional. Dates/times are local IST; types are `Comedy`, `Music`, `Theatre`, `Sports`, `Festival`, `Workshop` and `Other`. For Goa's towns, the adapter should return `city: "Goa"` and put the town/venue in `venue`, so statewide searches work. `nextPage` is the next integer page, or `null` when exhausted. Cancelled/postponed listings, past date ranges, unrelated cities, duplicates and invalid records are excluded. Upcoming events and ongoing multi-day events are included when their date ranges overlap the search. The feed must supply event data and poster rights appropriate for display and selected-event storage.

The server provides `/api/discovery/config`, `/places`, `/events`, `/details` and signed `/photo` links under `/api/discovery/`. Credentials stay on the server. Discovery has its own request allowance, and provider errors/partial results remain visible. The itinerary supports direct Google Routes with `GOOGLE_ROUTES_API_KEY` or an authorized route feed; durations are clearly labelled and do not replace manual buffers automatically. See [the API guide](docs/API-CONNECTIONS.md). Verified-account-required mode restricts connected discovery to signed-in accounts. Opening hours, booking and ticket availability need their own sources.

## Modules and dependency order

Browser files are linked from their pages and the explicit public allowlist. Credentials, databases, media directories and server modules are never served as static files. Shared business rules are usable in browser and server. See [MODULES.md](docs/MODULES.md) for the current ownership map.

## Verification and local version control

See [VERIFICATION.md](docs/VERIFICATION.md) for the completed phases, affected files, compatibility details, test results, live-versus-fixture limits and a guided walkthrough.

```sh
pnpm test
pnpm run check
pnpm exec playwright install chromium
pnpm run test:browser
pnpm run verify
```

Unit/server tests use isolated in-memory stores or disposable temporary directories. Browser cases use disposable identities, trips and browser contexts; they do not touch real plans or provider billing. **test-results/** contains ignored screenshots. The browser suite covers entry/loading, profile return context, all desktop/390px/320px sections, agreement through scrapbook, unfinished drafts, account membership, provider image reuse and overnight planning with touch/reduced-motion settings in a different browser timezone. Tests do not establish complete real-world venue coverage or successful live sign-in.

The browser default is Playwright Chromium. To use installed Chrome, set `PLANMATE_BROWSER_CHANNEL=chrome` in your shell before running the browser command. No machine-specific executable/dependency paths are embedded. The default Node test command disables worker isolation for compatibility with restricted local runners. CI installs Chromium and Linux browser dependencies and runs the same checks. The GitHub workflow is prepared locally; no remote CI run, push or deployment has occurred.

Local Git is initialized. Exclusions cover .env secrets, data, SQLite files, media, backups, node_modules, package stores and browser artifacts. The dependency lockfile is maintained with pnpm; do not create a conflicting package-lock.json. Formatting configuration, linked-file/script-order checks and portable regression tests make later changes reviewable. Rebuild bundled PDF assets with `pnpm run prepare:pdf` when needed; this development step downloads open-licensed fonts from their official sources, while users export PDFs with local bundled assets.
