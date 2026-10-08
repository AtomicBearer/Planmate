# Planmate API connection guide

This is the configuration map for the release. At this review, there is no local `.env`: Google sign-in, Places/photos, Static Maps, routes and live events are **unconfigured**. Adapter tests use fixtures; they do not prove real credentials work. No keys are needed for Planmate's shared planning rules, recommendations, expense arithmetic or PDF export.

Keep credentials in a private `.env` locally or the hosting platform's server environment. Never put them in `public/`, commit them, or paste them into chat. Restart the server after changing environment variables.

## What connects where

Paths below are relative to the project root. The diagnostic endpoint `/api/integrations/status` reports configuration without exposing keys or calling paid services.

| Feature / where to try it                                                            | Server setting                                                                  | Code to inspect                                                                           | External connection                                                                        | Current local state                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Verified sign-in on the login page; cross-device profiles                            | `GOOGLE_CLIENT_ID`                                                              | `server/services/account-service.js`, `public/js/account-client.js`, `public/js/login.js` | Google Identity Services browser SDK; server verifies ID tokens with `google-auth-library` | Not connected                                 |
| Explore places → Find more places / Load more results; venue details and real photos | `GOOGLE_PLACES_API_KEY`                                                         | `server/services/discovery.js`, `public/js/dashboard.js`                                  | Places API (New) Text Search, Place Details and Place Photos at `places.googleapis.com`    | Not connected                                 |
| Our itinerary → linked map → Refresh map                                             | `GOOGLE_STATIC_MAPS_API_KEY` plus Places for Google venue coordinates           | `server/services/map-service.js`, `public/js/outing-ui.js`                                | Maps Static API at `maps.googleapis.com/maps/api/staticmap`                                | Not connected                                 |
| Our itinerary → second/later stop → Check connected route                            | `GOOGLE_ROUTES_API_KEY` **or** `ROUTES_FEED_URL` + optional `ROUTES_FEED_TOKEN` | `server/services/map-service.js`, `public/js/outing-ui.js`                                | Google Routes `directions/v2:computeRoutes` or your authorized routing feed                | Not connected                                 |
| Explore places → Events → Find city events                                           | `EVENTS_FEED_URL` + optional `EVENTS_FEED_TOKEN`, **or** `TICKETMASTER_API_KEY` | `server/services/discovery.js`, `public/js/dashboard.js`                                  | Your authorized city feed or Ticketmaster Discovery v2                                     | Not connected; optional                       |
| Directions / venue source links                                                      | None                                                                            | `shared/planner-core.js`, `public/js/outing-ui.js`                                        | Browser opens Google Maps or the supplied venue/ticket link                                | Available; external website needs internet    |
| Handwritten fonts                                                                    | None                                                                            | `public/*.html`, `public/css/shared.css`                                                  | Google Fonts CSS and font files                                                            | External font loading; system fallbacks exist |
| PDF export                                                                           | None at runtime                                                                 | `public/js/itinerary-export.js`, `public/assets/vendor/`, `public/assets/pdf-fonts.js`    | Bundled local libraries/fonts                                                              | Available offline after page/assets load      |

Internal APIs are on the **same Node origin**: `/api/auth/*`, `/api/profile`, `/api/my-trips`, `/api/groups/*`, `/api/discovery/*`, `/api/health` and `/api/integrations/status`. Group maps/routes and uploaded media require active trip membership. Verified-account-required mode also restricts connected discovery to signed-in users. Shared mutations retain revision checks and account CSRF protection. There is no separate frontend API base URL to configure.

## 1. Connect Places and photos first

This supplies live venue discovery and real photos.

1. Create/select a Google Cloud project, attach billing and enable **Places API (New)**. Create a server API key and restrict it to that API. Apply suitable server/IP restrictions for the deployment. A browser-referrer-only key is inappropriate for these server calls. Follow [Google's Places setup](https://developers.google.com/maps/documentation/places/web-service/get-api-key).
2. Set `GOOGLE_PLACES_API_KEY`. This is an API key, not the Google OAuth client ID.
3. Restart, open Explore places, choose Goa and search beaches, cafés and nightclubs. Check relevance, author credits and venue/source links. Use Load more results to check pagination.
4. Run `pnpm run check:pilot` for configuration only. After you choose to incur live provider requests, run `pnpm run check:pilot -- --live`. The live pilot is bounded and reports partial/empty results; visually review the venues too.

Failures usually mean billing is inactive, the wrong API is enabled, API restrictions reject Places New, server/IP restrictions do not match the host, or quota is exhausted. The UI reports rejected/unreachable requests; it retains starter references. Missing venue photos are normal and retain the labelled category illustration. Provider data/photos remain transient rather than being copied into saved plans.

## 2. Connect verified Google sign-in

Create a **Web application OAuth client** in Google Auth Platform and configure its branding/audience. Set `GOOGLE_CLIENT_ID` to the client ID ending in `.apps.googleusercontent.com`. No OAuth client secret is used by this button/token-verification flow.

Register the exact public HTTPS origin under Authorized JavaScript origins, without `/login.html` or another path. For local testing register both `http://localhost` and `http://localhost:3000`. This app uses a JavaScript callback; do not invent a redirect receiver endpoint. Follow [Google's Identity setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

For public accounts set `PUBLIC_ORIGIN=https://your-actual-domain`, `SESSION_SECURE=true` and `ACCOUNT_MODE=required`. Guest mode supports device-only details; those names are unverified and their profiles do not follow them across devices.

Test sign-in with your actual Google account, reload, open a second browser/device, and verify the profile and protected trip membership follow that account. Test sign-out, invitation join and a stale profile save. If the button/popup fails, check the exact origin and client type, consent/audience settings, browser popup/network restrictions and the SDK network request. The server now sends a cross-origin-compatible referrer policy and popup policy; Google still requires its own origin configuration. Local HTTP behavior may vary; test the final HTTPS origin before publishing.

## 3. Connect map backgrounds

Enable **Maps Static API**, set `GOOGLE_STATIC_MAPS_API_KEY`, configure billing and API/server restrictions, then restart. See [Google's Static Maps setup](https://developers.google.com/maps/documentation/maps-static/get-api-key). Google venue locations also need Places details; sourced manual coordinates do not need a Places lookup.

Create a shared itinerary and refresh its map. Check that selecting a marker selects its stop and vice versa. If a background fails, inspect the server's provider configuration and quota. Missing coordinates remain listed explicitly; the app never guesses them. Up to ten Google locations are refreshed per map request. Images are proxied through membership-protected, expiring links, never a browser URL containing the API key.

## 4. Connect route checks

The new direct adapter avoids needing to build your own routing-feed server. Enable **Routes API**, set `GOOGLE_ROUTES_API_KEY`, configure billing/restrictions and restart. This uses the official [Compute Routes endpoint](https://developers.google.com/maps/documentation/routes/compute_route_directions) and a bounded response field mask. It returns driving duration/distance without live traffic; it is not a prediction of traffic at the trip time. See [Routes setup](https://developers.google.com/maps/documentation/routes/get-api-key) and [routing preference definitions](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RoutingPreference).

Schedule two stops with sourced coordinates or refreshable Google places. From the second stop choose Check connected route. The response shows provider, distance, duration, checked time and a source link. **The manual travel buffer stays unchanged**; review/edit it explicitly if necessary. Unknown locations, no driving route, provider rejection and malformed responses produce errors without modifying the itinerary.

If you already have an authorized routing feed, it takes precedence over Google Routes. Set an HTTPS `ROUTES_FEED_URL` and optional bearer token. Planmate POSTs:

```json
{
  "from": { "latitude": 15.5, "longitude": 73.8, "source": "https://source.example/location" },
  "to": { "latitude": 15.6, "longitude": 73.9, "source": "https://source.example/location" },
  "date": "2026-10-10",
  "arrivalTime": "18:00",
  "timezone": "Asia/Kolkata"
}
```

The feed must return `durationSeconds` (0–86400), `distanceMeters` (0–2000000), `provider` and an HTTPS `sourceUrl`. The coordinates and response below are schema examples, not real travel claims:

```json
{ "durationSeconds": 600, "distanceMeters": 3000, "provider": "Your authorized provider", "sourceUrl": "https://source.example/route" }
```

## 5. Connect live events when a real provider is available

The [README event contract](../README.md#connect-city-events) defines the required query parameters, dates, source/ticket links, rights and JSON shape. `EVENTS_FEED_URL` must be a real authorized provider/organizer endpoint transformed to that contract. BookMyShow/District website URLs are not API feed URLs. Planmate includes no ticket-site scraping.

Alternatively configure a [Ticketmaster Discovery API key](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/). A configured city feed takes precedence. Check actual India/city inventory before publishing; an empty result does not prove no events exist. Published event dates and fixed start times are preserved. Keeping this optional provider unconfigured does not block the planning features.

## Connections that do not need API keys

[Google Maps direction/search URLs](https://developers.google.com/maps/documentation/urls/get-started) need `api=1` but no Google API key. Fonts use public Google Fonts resources with local system fallbacks. PDF generation uses committed local assets; `pnpm run prepare:pdf` is a development-only asset rebuild that downloads open-licensed fonts. SQLite and scrapbook uploads use private local disk, not a third-party database/photo API.

## Public-link diagnosis

Run `pnpm run check:launch` after setting the public deployment environment. It checks host binding, origin, cookie settings, data path, feed URLs and optional service settings without printing credential values or contacting providers. See [the public deployment checklist](DEPLOYMENT.md).

If HTML works but `/api/*` fails, deploy the **Node app**, not only `public/`, and proxy pages plus API to the same origin. Preserve the incoming Host header. For errors joining/saving, check the chosen account mode, cookies, membership and revision; refreshing is deliberate after a stale edit. Missing scrapbook images after a restart usually mean the host's disk was ephemeral or media was not restored with its database. Never overwrite the database to “fix” an API issue.
