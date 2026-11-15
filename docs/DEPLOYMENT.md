# Publish Planmate without external API keys

For **shared planning on the existing Netlify site**, follow [NETLIFY-SHARED.md](NETLIFY-SHARED.md). The new adapter uses Functions and private Blobs storage for guest trips. For **browser folder/ZIP uploads**, follow [NETLIFY-UPLOAD.md](NETLIFY-UPLOAD.md); that method remains personal planning only. The instructions below publish the complete application on a Node host.

This release runs the complete website in guest mode. It opens with no saved trip, suggested members or itinerary. A visitor creates a trip or joins a friend's private invitation. The curated discovery catalogue contains reference places to browse; it does not create a trip. Existing saved personal plans remain accessible.

## What works without keys

Private trip invitations, availability, attendance, preferences, recommendations, draft voting, suggestions/comments, scheduling, reorder/undo, group visits, INR expenses/repayments, photo scrapbooks and PDF export use Planmate's own Node server. Device profiles and wishlists use browser storage. Fonts, illustrations and PDF libraries are served locally.

Live venue searches/photos, Google map backgrounds, verified route checks, verified Google accounts and live event feeds stay off unless deliberately configured. Add custom places/events with their real source links, enter group cost/travel estimates and sourced coordinates, and use the existing directions links. Missing venue details remain unknown. Guest names are unverified; personal profiles and guest access do not automatically follow someone to another device. A person can join again using an invitation, but this creates another membership rather than recovering their old one.

The internal `/api/*` endpoints must remain available: they provide shared planning, permissions and storage. They require no third-party API key in guest mode.

## Choose a host

Store the code on GitHub and connect it to a **Node web service with persistent disk**, HTTPS and one running instance. Keep pages and `/api/*` on the same origin; the reverse proxy must preserve the incoming Host header. Node 24.19.0 and pnpm 11.25.0 are pinned for this release.

[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages) serves static files and cannot run this Node server. Netlify uses the separate [Functions/Blobs adapter](NETLIFY-SHARED.md), with guest memberships and the same planning commands. Uploading `public/` alone provides neither backend.

The included `render.yaml` configures a GitHub-connected [Render Node web service](https://render.com/docs/deploy-node-express-app). **It uses paid compute and a paid 3 GB persistent disk.** Review [current pricing](https://render.com/pricing) before approving any deployment. No hosting resource is created by saving this file. Render's ordinary service filesystem is ephemeral, so the disk is required for this architecture; see [persistent disk requirements](https://render.com/docs/disks). A free Render service without that disk is unsuitable for durable shared trips and photos. A completely free solution needs a different storage/backend setup or an existing server you already operate.

## Step 1 — Check the code locally

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm exec playwright install chromium
pnpm run test:browser
pnpm start
```

Open `http://localhost:3000/`. With a new browser profile, continue with your device details and check that the dashboard has no trip. Existing browser storage can contain your own previously saved trips; use a private browser window to inspect the fresh experience. Existing local plans are preserved.

## Step 2 — Put the source on GitHub

1. Create a GitHub repository and upload/push this project's source, including `render.yaml`, `.node-version`, the lockfile and `.github/workflows/check.yml`.
2. Keep `.env`, `data/`, backups, `node_modules/`, `.qa/` and test output out of the repository. They are ignored already. Check the files being committed before pushing, especially if you previously tracked private files.
3. Open the repository's **Actions** tab. The Planmate checks workflow installs dependencies, validates linked files, runs the rule/server tests and runs browser journeys in Chromium. Confirm it passes before deploying. GitHub-hosted CI is prepared here; a local pass does not prove that a remote workflow has run.

## Step 3 — Connect Render

1. In Render, select **New → Blueprint** and connect the GitHub repository containing `render.yaml`.
2. Review the proposed **paid** Node service and disk before approving creation. The configuration selects Singapore, one instance and a 3 GB disk mounted at `/var/data`.
3. The build installs pinned dependencies, checks the project and runs Node tests. Startup runs `check:launch` before starting the server. The health check is `/api/health`. Automatic deployment waits for repository checks.
4. No Google, map, route or event credentials are required. Leave those environment variables unset.

The same settings can be entered manually on any compatible Node host:

| Setting             | Value                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Build command       | `npm install --global pnpm@11.25.0 && pnpm install --frozen-lockfile && pnpm run check && pnpm test` |
| Start command       | `pnpm run check:launch && pnpm start`                                                                |
| Node version        | `24.19.0`                                                                                            |
| `HOST`              | `0.0.0.0`                                                                                            |
| `PORT`              | The port assigned by the host                                                                        |
| `ACCOUNT_MODE`      | `guest`                                                                                              |
| `SESSION_SECURE`    | `true`                                                                                               |
| `NODE_ENV`          | `production`                                                                                         |
| `PLANMATE_DATA_DIR` | An absolute private directory on persistent disk; Render uses `/var/data/planmate`                   |
| `PUBLIC_ORIGIN`     | The exact public HTTPS origin, without a path or trailing slash                                      |

On Render, its built-in [`RENDER_EXTERNAL_URL`](https://render.com/docs/environment-variables) supplies the assigned HTTPS origin when `PUBLIC_ORIGIN` is unset. If adding a custom domain, set `PUBLIC_ORIGIN` to that domain and use it consistently for invitations and browser access. An explicitly set origin always takes precedence.

## Step 4 — Keep the first launch empty

Use a new persistent data directory. The server creates its schema without inserting sample groups, members, suggestions or stops. The deployment does not copy local `data/`, database backups or browser storage. There is no seed command in the build/start process.

Do not erase a used production directory to obtain a blank welcome page: that would destroy real members' trips and photos. New visitors already get the blank welcome page. Use a private browser window to check it.

## Step 5 — Check the real public link

1. Open `/api/health`: expect `ok: true`, `mode: "guest"`, `storage: "sqlite-single-host"` and `verifiedSignInConfigured: false`. `/api/integrations/status` should show optional services unconfigured. Neither response proves a third-party service is connected.
2. In a fresh browser, open the root URL. Check the device profile flow, empty dashboard, mobile navigation and separate profile page. No Google sign-in button or automatic external font/sign-in requests should appear.
3. Create your own shared trip. Open its invitation in another browser and join as a second person. Submit availability and ideas, update attendance, add a comment, and verify that both browsers see shared changes. Attendance and suggestion responses remain separate.
4. Schedule actual stops, enter estimates, review conflicts, try reorder/undo and explicitly confirm the plan. Verify that a material edit requests reconfirmation. Try Today, expenses, repayments and PDF export.
5. Mark a stop visited and attach your own JPEG/PNG photo with a caption. Check that another member can see it and an unauthenticated browser cannot access its media URL.
6. Restart/redeploy the service and confirm the trip and photo still exist. A fresh visitor should still have no preselected trip.
7. Check `.env`, `/data/`, `/server/index.js`, `/docs/DEPLOYMENT.md` and `/render.yaml` are not public. The server uses an explicit browser-file allowlist.

This step requires the deployed URL; it cannot be replaced by local tests. Hosting and DNS setup remain operator actions.

## Step 6 — Back up and operate

Keep one Node instance: SQLite and local media do not support multiple independent instances. Review storage and existing limits before accepting many groups: 100 shared groups, 5 MB uploads, and a 2 GiB media-store quota. The 3 GB disk leaves space for media plus the database, but monitor usage and grow it before it fills.

Back up the database and media together using [ACCOUNT-STORAGE.md](ACCOUNT-STORAGE.md). Follow the documented offline backup/restore procedure; don't copy a live SQLite file independently of its transaction state. Server shutdown drains requests and closes storage during ordinary host termination.

Before a broad public launch, define privacy, retention/deletion, abuse handling and account recovery policies. Guest mode protects trip changes and photos with private invitation/membership tokens; it does not verify identity. Verified cross-device accounts are optional future setup, covered separately in [API-CONNECTIONS.md](API-CONNECTIONS.md). No external integrations or migration to Netlify are needed to operate this Node-hosted guest release.
