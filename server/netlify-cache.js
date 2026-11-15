"use strict";
/* Short-lived provider references never enter trip data or the public build. */
function discoverySessions(store, now = Date.now) {
    const etags = new Map();
    return {
        async get(key) {
            const entry = await store.getWithMetadata("search/" + key, {
                type: "json",
                consistency: "strong",
            });
            if (!entry || entry.data.expires < now()) return null;
            etags.set(key, entry.etag);
            return { ...entry.data, seen: new Set(entry.data.seen) };
        },
        async set(key, value) {
            const etag = etags.get(key);
            const result = await store.setJSON(
                "search/" + key,
                { ...value, seen: [...value.seen] },
                {
                    ...(etag ? { onlyIfMatch: etag } : { onlyIfNew: true }),
                    metadata: { expires: value.expires },
                },
            );
            if (!result.modified)
                throw Object.assign(new Error("This search is loading elsewhere. Try again."), {
                    status: 409,
                });
            etags.set(key, result.etag);
        },
    };
}
function mapImages(store) {
    return {
        get: (key) => store.get("map/" + key, { type: "json", consistency: "strong" }),
        set: (key, value) =>
            store.setJSON("map/" + key, value, { metadata: { expires: value.expires } }),
    };
}
async function signingSecret(store) {
    const crypto = require("node:crypto");
    let secret = await store.get("photo-signing-secret", { type: "text", consistency: "strong" });
    if (!secret) {
        await store.set("photo-signing-secret", crypto.randomBytes(32).toString("hex"), {
            onlyIfNew: true,
        });
        secret = await store.get("photo-signing-secret", { type: "text", consistency: "strong" });
    }
    if (!secret)
        throw Object.assign(new Error("Discovery configuration unavailable."), { status: 503 });
    return secret;
}
module.exports = { discoverySessions, mapImages, signingSecret };
