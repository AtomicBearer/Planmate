# Publish Planmate

Deploy the same application that users run locally: the Node server, organized browser files, shared rules and private storage. There is no separate presentation site or generated sample trip. A new visitor creates a trip, opens an invitation or selects a saved trip.

## Hosting requirements

- Node.js 24.13 or newer and the pinned pnpm dependencies.
- One running Node instance with persistent disk for SQLite and member-uploaded photos.
- HTTPS and the same origin for pages and `/api/*`.
- A reverse proxy that preserves the incoming Host header.

Static-only hosting of `public/` cannot provide shared planning, account profiles or private uploads. The current SQLite/media architecture does not support multiple independently running hosts.

## Configuration

1. Deploy the complete source repository, excluding local `.env`, `data/`, dependencies and test artifacts. Install with `pnpm install --frozen-lockfile` and start with `pnpm start`.
2. Set `HOST=0.0.0.0`. Use the platform's assigned `PORT` when supplied.
3. Set `PUBLIC_ORIGIN` to the exact public HTTPS origin without a path/trailing slash, and `SESSION_SECURE=true`.
4. Set `PLANMATE_DATA_DIR` to an absolute directory on the host's persistent disk, outside `public/`.
5. For verified public accounts, configure `GOOGLE_CLIENT_ID`, register the hosted origin with Google, and set `ACCOUNT_MODE=required`. Guest/device details are not verified accounts and do not provide cross-device profiles.
6. Configure optional places/photos, map, route and event providers using [API-CONNECTIONS.md](API-CONNECTIONS.md). Put credentials in private server environment variables.
7. Run `pnpm run check:launch`. It reports configuration gaps without showing keys or making external requests.

## Verify the actual public URL

Run the project checks before deploying, then verify the deployed environment itself:

- Sign in, reload and open the account profile on another device. Confirm sign-out and account access restrictions.
- Create a trip and open its invitation in another browser. Submit availability, preferences, suggestion responses and comments. Verify that simultaneous stale edits are rejected safely.
- Choose a date, apply a reviewed draft, confirm the plan, and check that a material edit requests reconfirmation.
- Exercise itinerary ordering, directions, PDF export, expenses and a private photo upload.
- Restart the server and confirm that the shared plan and its photo survive. Back up database and media together using [ACCOUNT-STORAGE.md](ACCOUNT-STORAGE.md).
- Test configured external services live. `/api/integrations/status` reports configuration only; it does not establish successful sign-in, inventory, billing or provider availability.

Provider credentials and public hosting remain operator setup. The website keeps useful empty/error states while those services are unavailable; it never invents venue data or presents guest details as verified authentication.
