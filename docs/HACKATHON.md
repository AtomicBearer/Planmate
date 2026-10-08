# Hackathon readiness and presentation

## Assessment

Planmate has a coherent product journey: agree on availability → understand each friend's needs → shortlist suggestions → compare and explicitly apply a plan → confirm attendance → use the outing → settle expenses and share memories. Its distinctive scrapbook styling and member-level explanations support that promise. The implementation has working shared persistence and permission/revision checks rather than just static demo screens.

The remaining presentation risks are external credentials, live venue/event relevance, and the actual public HTTPS host with persistent storage. Treat the current state as a tested local implementation, not a verified public deployment. All original features remain; this review reorganized their files, added a demo guide and configuration checks, corrected integration wiring, and added the direct Google Routes adapter.

## A four-minute judge walkthrough

Open `/demo.html` before presenting. Keep the organizer's browser and a friend's browser/device ready. Create your own shared trip instead of presenting the labelled sample friends as real people.

| Time      | Show                                                                | Explain                                                                                                                |
| --------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:25 | Login and the active trip                                           | “Group chats collect ideas, but they don't turn different needs into a plan everyone agrees to.”                       |
| 0:25–1:10 | Two date responses, common window, organizer chooses                | “A winning vote doesn't silently become a confirmed trip.”                                                             |
| 1:10–2:00 | Different trip interests/budgets, a suggestion response and comment | “We show whose needs or budget remain unmet, including missing information.”                                           |
| 2:00–2:55 | Compare drafts, explicitly apply, itinerary and PDF                 | “The group chooses the tradeoff; fixed times and travel conflicts remain visible.”                                     |
| 2:55–3:25 | Attendance, confirmation, a material edit                           | “Attendance is separate from liking a place. An agreed version is recorded, and changed plans request reconfirmation.” |
| 3:25–4:00 | Today/past day, an actual bill and scrapbook                        | “Planning, the outing and its memories stay together. Actual payments stay separate from estimates.”                   |

Prepare suggestions and supplied sample estimates in a clearly labelled demonstration trip before the timer starts. Keep a pre-exported PDF as a presentation backup. Use your own consented photo. Run a venue search before presenting if Places is connected, while retaining manual/starter references if internet/provider access fails. A public shared-plan demo still needs the server; this is not a promise of offline synchronization.

## Public link deployment

The application needs a Node.js 24.13+ host with **one running instance and persistent disk** for SQLite and uploaded media. Uploading only the HTML/CSS/JS to static hosting will not provide shared planning, accounts or photo uploads.

1. Put the complete source repository on the chosen Node host, excluding `.env`, local `data/`, dependencies and test artifacts. Keep provider credentials in its private environment settings.
2. Install with `pnpm install --frozen-lockfile`. Start with `pnpm start`; the platform may supply `PORT`.
3. Set `HOST=0.0.0.0`, the exact `PUBLIC_ORIGIN=https://your-actual-domain`, `SESSION_SECURE=true`, and an absolute `PLANMATE_DATA_DIR` on the persistent disk, outside `public/`. Set the required provider variables from [API-CONNECTIONS.md](API-CONNECTIONS.md).
4. For public verified accounts, set `ACCOUNT_MODE=required` and configure the Google Web client ID plus the exact hosted origin. A short demo may use `ACCOUNT_MODE=demo`, but its unverified identity and browser-only profile limitations must stay visible. Required mode refuses startup without its client ID.
5. Serve pages and `/api/*` on the same HTTPS origin. A reverse proxy must preserve the incoming Host header. Keep one instance; do not use ephemeral/serverless storage for the current SQLite/media design.
6. Run `pnpm run check:launch` using the deployment environment. Provider warnings are separate from deployment configuration errors. This command does not verify billing, origin registration, disk durability or live credentials.
7. Open `/api/health` and `/demo.html` on the actual URL. Test sign-in (if configured), profile reload on another device, invitation join, two simultaneous edits, page reload and a server restart. Verify a shared plan and an uploaded photo survive that restart.
8. Perform an offline private backup before the event using [ACCOUNT-STORAGE.md](ACCOUNT-STORAGE.md). Keep the presentation's invite unexpired and reachable from the public origin.

No hosting account, domain, remote repository or deployment has been created by this local review. Once a host is selected, the remaining tasks are its deployment environment, persistent disk, domain/origin setup and live checks.

## Truthful scope for questions

- Recommendations use transparent deterministic rules; there is no external generative AI dependency or claim of an exhaustive optimization solver.
- The starter catalogue is 110 references across 32 cities, not every place or current event in India. Connected Places results depend on provider inventory and quotas.
- Unknown prices, opening hours, coordinates, travel and ticket availability are not invented. Costs shown by the planner are supplied estimates; actual expense records are separate.
- Route checks are supplied provider estimates. The Google adapter returns driving without live traffic, leaving the group's manual buffer intact.
- Google sign-in is verified only when configured and successfully exercised. Demo names/emails are not verified identities.
- The current database/media architecture targets a single host. Public scale, distributed storage, monitored backups and broader provider/account production review remain release work.

## Project layout

```text
public/          Browser pages, css/, js/, assets/
shared/          Rules and catalogue used by both browser and server
server/          HTTP API, services/, storage/, private static allowlist
docs/            API setup, demo/deployment, architecture and verification
scripts/         Checks, backup/restore, provider pilot, PDF asset rebuild
tests/           Focused rule/server tests and browser journeys
licenses/        Bundled dependency/font license notices
data/            Private SQLite/media (ignored; location unchanged)
server.js        Compatible root launch entry point
```

The page URLs remain `/login.html`, `/dashboard.html` and `/profile.html`. Old public CSS/JS URLs have explicit aliases for existing tabs. Saved plans, media, invitation codes and profile storage keys were not moved or reset. Direct-file preview now starts from `public/dashboard.html`.
