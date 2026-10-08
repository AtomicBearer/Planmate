/* Bounded, opt-in live pilot. No third-party place/photo data is written to disk. */
"use strict";
const fs = require("node:fs"),
    { createDiscovery } = require("../server/services/discovery.js");
async function pilot({ live = false, discovery = createDiscovery() } = {}) {
    const config = discovery.config(),
        report = {
            city: "Goa",
            checkedAt: new Date().toISOString(),
            configuration: config,
            liveVerified: false,
            checks: [],
            note: "Configuration-only check. Use --live for up to 6 Places search pages and 1 photo lookup; billable provider requests are opt-in.",
        };
    if (!live || !config.places) {
        if (!config.places)
            report.note =
                "Places is unconfigured. No live inventory, photos, map or routing verification was performed. Manual suggestions and starter picks remain available.";
        return report;
    }
    let photo = null;
    for (const [category, q] of [
        ["Beach", "beaches"],
        ["Food", "cafes"],
        ["Nightlife", "night clubs"],
    ]) {
        const ids = new Set(),
            check = {
                category,
                pages: 0,
                duplicates: 0,
                photos: 0,
                missingPhotos: 0,
                addressesToReview: 0,
                warnings: [],
            };
        let cursor = "";
        try {
            for (let i = 0; i < 2; i++) {
                const result = await discovery.places(
                    new URLSearchParams({
                        city: "Goa",
                        category,
                        q,
                        ...(cursor ? { cursor } : {}),
                    }),
                );
                check.pages++;
                for (const p of result.places) {
                    if (ids.has(p.id)) check.duplicates++;
                    ids.add(p.id);
                    if (p.photoUrl) {
                        check.photos++;
                        photo ||= p.photoUrl;
                    } else check.missingPhotos++;
                    if (!/\bgoa\b/i.test(p.area)) check.addressesToReview++;
                }
                check.warnings.push(...(result.warnings || []));
                cursor = result.cursor || "";
                if (!cursor) break;
            }
            check.uniquePlaces = ids.size;
            check.moreAvailable = Boolean(cursor);
            check.status = check.warnings.length ? "partial" : "received";
        } catch (e) {
            check.status = "failed";
            check.error = e.message;
        }
        report.checks.push(check);
    }
    if (photo) {
        try {
            const url = new URL(photo, "http://localhost");
            const result = await discovery.photo(url.searchParams);
            report.photoLookup = { status: "received", https: result.startsWith("https:") };
        } catch (e) {
            report.photoLookup = { status: "failed", error: e.message };
        }
    }
    report.liveVerified = report.checks.every((c) => c.status === "received" && c.uniquePlaces > 0);
    report.note =
        "Live adapter responses checked; relevance needs visual review in the Goa dashboard. Photo lookup validates a provider reference, not a downloaded image. Maps/routes/events require their own configured provider and trip-member checks. No prices, opening hours or routes were inferred.";
    return report;
}
if (require.main === module) {
    if (fs.existsSync(".env")) process.loadEnvFile(".env");
    pilot({ live: process.argv.includes("--live") })
        .then((r) => {
            console.log(JSON.stringify(r, null, 2));
            if (r.checks.some((c) => c.status === "failed")) process.exitCode = 1;
        })
        .catch((e) => {
            console.error(e.message);
            process.exitCode = 1;
        });
}
module.exports = { pilot };
