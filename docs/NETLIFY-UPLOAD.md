# Upload Planmate to Netlify

Use the prepared **`output/planmate-netlify.zip`**, or the **`output/netlify`** folder. The folder contains `index.html`, the other pages, styles, browser scripts, shared rules, fonts, PDF assets and their required license notices. It contains no `.env`, saved trips, member data, server source or dependencies.

## Upload in your browser

1. Extract `planmate-netlify.zip`. Open the extracted folder and find the folder containing **`index.html`**.
2. Sign in to [Netlify](https://app.netlify.com/) and open [Netlify Drop](https://app.netlify.com/drop).
3. Drag the folder containing `index.html` into the upload area. Do **not** upload the main source/project folder or `public/` on its own.
4. Wait for Netlify to provide your website URL. Open it in a private browser window to check the fresh, empty start.
5. Enter your device-profile details, create your first personal trip and reload. Your trip should still be there in the same browser.

Netlify's [folder-upload instructions](https://docs.netlify.com/deploy/create-deploys/#drag-and-drop) recommend extracting ZIPs first. To update the site later, rebuild this folder and drag the new output into that site's **Deploys** upload area.

## What this upload supports

The original theme and pages remain. Create personal trips, browse reference places or add your own, use trip preferences/recommendations, plan dates and stops, review conflicts and estimates, track expenses, record visits, edit your profile/wishlist and export an itinerary PDF. Plans start empty; reference venues do not create a trip. All theme fonts and PDF assets are local, and no external API keys are needed.

**This is personal planning saved in browser storage.** Reloading the same site in the same browser retains your plans. Another browser/device starts with its own empty storage. Clearing site storage can remove your profile and plans. PDFs can be sent to friends, but edits do not synchronize between devices.

**Shared invitations, independently submitted group responses/comments, verified accounts and private photo uploads cannot work through a browser folder upload alone.** Netlify Drop publishes static files; it does not deploy this project's Node server. The interface explains the limits and avoids failed backend requests. Visited stops and notes remain usable in the scrapbook without uploaded photos. Live venue searches/photos, connected routes/maps and event feeds stay off.

The full server, shared planning and upload code are preserved in the source project. Publishing all collaborative features on Netlify later requires Netlify Functions plus durable database/media storage, deployed via Git or the CLI. Uploading the existing SQLite database or server scripts as public files would not provide that backend.

## Rebuild the upload after edits

From the source project:

```sh
pnpm install --frozen-lockfile
pnpm run build:netlify
```

This replaces only the dedicated `output/netlify` build folder. It copies the explicit browser-file allowlist, shared rules and selected asset-license notices, creates the root entry page, adds Netlify security headers/compatible asset redirects, and marks the pages to use browser storage. The normal `pnpm start` Node app continues to use its original server behavior.

On Windows, recreate the convenience ZIP with:

```powershell
Compress-Archive -Path '.\output\netlify\*' -DestinationPath '.\output\planmate-netlify.zip' -Force
```

Keep the source, licenses and development documents separately. `netlify.toml` can also build these same personal-planning files if you later connect the repository; it does not deploy the complete shared backend.
