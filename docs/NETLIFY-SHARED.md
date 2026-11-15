# Shared Planmate on the existing Netlify site

Target: https://planmate-techtonic.netlify.app/

The repository now includes Netlify Functions and private Netlify Blobs storage. The existing Node/SQLite deployment remains supported. Netlify's shared build uses the same pages, theme and planning rules, with a separate server adapter for guest invitations.

## Publish through Git

1. Commit and push the reviewed source to the repository connected to this **existing** Netlify site. Keep `.env`, `data/`, `node_modules/`, test output and `.netlify/` private. If the site was created through Drop, connect this source repository in the site's build settings first.
2. Use the included `netlify.toml`: build command `pnpm run build:netlify:shared`, publish directory `output/netlify`, functions directory `netlify/functions`. Node and pnpm versions are pinned in the project.
3. Deploy the source, not just the generated folder. Netlify's build bundles `planmate.mjs` and the reference-cleanup function. Site-scoped Blobs are initialized through the function runtime; a local SQLite file is not used by these functions.
4. In the site's private environment settings, add any desired provider keys for **Functions**. A local `.env` is not uploaded automatically. `GOOGLE_PLACES_API_KEY` enables existing live venue searches and real photos. Events can remain unconfigured. No keys are necessary for the 60 regional references, trains or guest collaboration.
5. Check `/api/health` on the public URL. Expect `ok: true`, `storage: "netlify-blobs"` and `mode: "guest"`. A 404 or a page reporting device-only storage means the shared deployment has not reached that site.
6. Create one shared trip in a fresh browser, copy its invitation, join from two other browsers and submit ideas. Refresh all three. Save an overnight train and export the PDF. Check the Netlify function logs if a request fails.

## Publish through the Netlify CLI

Run from the repository root after signing in to your own Netlify account:

```sh
pnpm --package=netlify-cli@27.19.0 dlx netlify login
pnpm --package=netlify-cli@27.19.0 dlx netlify link
pnpm --package=netlify-cli@27.19.0 dlx netlify build
pnpm --package=netlify-cli@27.19.0 dlx netlify deploy --prod
```

During `link`, select **planmate-techtonic**, the existing site. Do not create a replacement site. Review the target before the production deploy. A preview deploy uses isolated storage; its test trips do not become production trips.

## Storage and access

- One private JSON record per trip, including hashed guest tokens and invitation credentials. Reads use strong consistency. Updates require both the current plan revision and an atomic matching storage ETag, so concurrent requests cannot overwrite an accepted change.
- Production uses site-wide stores `planmate-production-trips`, `planmate-production-photos`, and `planmate-production-references`. They survive production redeploys. Preview deploys use a deploy-ID namespace.
- Guest access is saved in each browser. Google account login/recovery is not implemented in this Netlify adapter; the Node host still supports its existing optional verified-account mode. Setting `GOOGLE_CLIENT_ID` alone does not enable accounts on Netlify.
- The private photo adapter checks active membership, visit status, revision and author permissions. JPEG/PNG files are re-encoded with Sharp to strip camera metadata. Uploads are limited to 4 MB on Netlify, 40 per member, 100 per trip and 200 MB per trip.
- Search pagination and map references survive separate function instances. Photo signatures share a private server key. These transient references expire; an hourly production task removes up to 500 expired references, with a one-hour grace period. Review/clear unused preview stores through Netlify. No cleanup task deletes trip plans or member photos.
- The function has an IP/domain request limit. Netlify storage, compute and external API usage remain subject to the hosting account's quotas and pricing. Configure usage alerts and provider quotas before wider public promotion.
- There is no automatic migration from browser-only trips or the Node server's SQLite database. Existing personal browser data remains intact. Create a shared space deliberately to collaborate.

## Backups and scale

This is a deployable group-trip pilot, not a complete account/billing/operations platform. Keep restricted backups of the private trip and photo stores using Netlify's supported tooling. Restore into an isolated preview and test permissions before replacing production data. Never put backups under the public build directory.

Before larger usage, add verified account recovery, administrative deletion/retention controls, monitoring, per-account quotas and a documented backup/restore drill. The adapter provides per-trip atomicity; it does not provide cross-trip database transactions. Provider bookings, train status and current forest permissions remain external.

References: [Netlify Functions](https://docs.netlify.com/build/functions/api/) and
[Netlify Blobs atomic writes and consistency](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).
