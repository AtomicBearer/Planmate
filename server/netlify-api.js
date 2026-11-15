/* Netlify guest-sharing adapter. Core commands remain shared with the Node server.
 * One blob per trip, strong reads and conditional writes prevent lost updates. */
"use strict";
const crypto = require("node:crypto");
const Core = require("../shared/planner-core");
const { processImage } = require("./services/media-store");
const { describeIntegrations } = require("./services/integrations");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
};
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (status, value) => Response.json(value, { status, headers });
async function readBody(request, limit = 256 * 1024) {
    if (Number(request.headers.get("content-length")) > limit)
        fail(413, "This upload is too large.");
    const chunks = [],
        reader = request.body?.getReader();
    if (!reader) fail(400, "Supply a request body.");
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            fail(413, "This upload is too large.");
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}
function authenticate(request, group) {
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const id = token && group.tokens[digest(token)];
    if (!id || !group.state.members.some((m) => m.id === id && !m.removed))
        fail(401, "Open your invitation to join this trip.");
    return id;
}
function invitation(group) {
    const invite = crypto.randomBytes(24).toString("base64url");
    group.invite = { hash: digest(invite), expires: Date.now() + 7 * 86400000, revoked: false };
    return invite;
}
function createNetlifyApi({ store, media, discovery, maps }) {
    async function load(code) {
        const entry = await store.getWithMetadata("trips/" + code, {
            type: "json",
            consistency: "strong",
        });
        if (!entry) fail(404, "This planning space was not found.");
        entry.data.state = Core.migrate(entry.data.state);
        return entry;
    }
    async function save(code, group, etag) {
        const result = await store.setJSON(
            "trips/" + code,
            group,
            etag ? { onlyIfMatch: etag } : { onlyIfNew: true },
        );
        if (!result.modified)
            fail(409, "The plan changed. Refresh before saving. Your input is still here.");
    }
    return async function handle(request) {
        try {
            const url = new URL(request.url),
                method = request.method;
            if (!["GET", "POST"].includes(method)) fail(405, "Unsupported request method.");
            if (method === "POST") {
                const origin = request.headers.get("origin");
                if (
                    (origin && origin !== url.origin) ||
                    request.headers.get("sec-fetch-site") === "cross-site"
                )
                    fail(403, "Open Planmate on this website before making changes.");
            }
            const body = async () => {
                if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
                    fail(415, "Send this change as JSON.");
                let value;
                try {
                    value = JSON.parse((await readBody(request)).toString("utf8"));
                } catch (e) {
                    if (e.status) throw e;
                    fail(400, "The request is not valid JSON.");
                }
                if (!value || Array.isArray(value) || typeof value !== "object")
                    fail(400, "Supply an object.");
                return value;
            };
            if (url.pathname === "/api/health" && method === "GET")
                return json(200, {
                    ok: true,
                    mode: "guest",
                    storage: "netlify-blobs",
                    verifiedSignInConfigured: false,
                    planningFeatures: 2,
                    photoLimitBytes: 4 * 1024 * 1024,
                    map: maps.config(),
                });
            if (url.pathname === "/api/integrations/status" && method === "GET")
                return json(
                    200,
                    describeIntegrations({
                        accounts: { configured: false, required: false },
                        discovery: discovery.config(),
                        maps: maps.config(),
                    }),
                );
            if (url.pathname === "/api/auth/config" && method === "GET")
                return json(200, { configured: false, required: false, mode: "guest" });
            if (url.pathname === "/api/auth/session" && method === "GET")
                return json(200, { account: null });
            if (url.pathname === "/api/my-trips") fail(401, "Use the trips saved in this browser.");
            if (url.pathname.startsWith("/api/discovery/")) {
                if (method !== "GET") fail(405, "Discovery accepts GET requests.");
                const action = url.pathname.slice(15);
                if (action === "config") return json(200, discovery.config());
                if (!["places", "details", "photo", "events"].includes(action))
                    fail(404, "Unknown discovery action.");
                if (action === "photo")
                    return new Response(null, {
                        status: 302,
                        headers: { ...headers, Location: await discovery.photo(url.searchParams) },
                    });
                return json(200, await discovery[action](url.searchParams));
            }
            if (url.pathname === "/api/groups" && method === "POST") {
                const value = await body(),
                    name = Core.text(value.name, "Name", 60);
                const code = crypto.randomBytes(12).toString("base64url"),
                    token = crypto.randomBytes(32).toString("base64url"),
                    memberId = crypto.randomUUID();
                const state = Core.createState(value.trip, { id: memberId, name });
                const group = { state, tokens: { [digest(token)]: memberId } },
                    invite = invitation(group);
                await save(code, group);
                return json(201, { code, token, memberId, state, invite });
            }
            const match = url.pathname.match(
                /^\/api\/groups\/([A-Za-z0-9_-]{16})(?:\/(join|commands|invite|map|map-image|route|photos)(?:\/([0-9a-f-]{36}\.(?:jpg|png)))?)?$/,
            );
            if (!match) fail(404, "Planning endpoint not found.");
            const [, code, action, photoId] = match;
            // Read after consuming bodies, so slow requests never use an earlier snapshot.
            const value = method === "POST" && action !== "photos" ? await body() : null;
            const entry = await load(code),
                group = entry.data;
            if (action === "join" && method === "POST") {
                if (
                    !group.invite ||
                    group.invite.revoked ||
                    group.invite.expires <= Date.now() ||
                    digest(String(value.invite || "")) !== group.invite.hash
                )
                    fail(
                        403,
                        "This invitation is missing, expired or revoked. Ask the organizer for a new link.",
                    );
                if (
                    group.state.members.filter((m) => !m.removed).length >= 30 ||
                    group.state.members.length >= 100
                )
                    fail(400, "This group has reached its membership limit.");
                const name = Core.text(value.name, "Name", 60),
                    memberId = crypto.randomUUID(),
                    token = crypto.randomBytes(32).toString("base64url");
                group.state.members.push({ id: memberId, name });
                group.tokens[digest(token)] = memberId;
                group.state.revision++;
                group.state.updatedAt = new Date().toISOString();
                if (group.state.confirmation) group.state.confirmation.needsReview = true;
                group.state.materialVersion++;
                await save(code, group, entry.etag);
                return json(201, { code, token, memberId, state: group.state });
            }
            const memberId = authenticate(request, group);
            const recheck = async () => authenticate(request, (await load(code)).data);
            if (!action && method === "GET") return json(200, { state: group.state, memberId });
            if (action === "map" && method === "GET") {
                const result = await maps.map(
                    group.state,
                    url.searchParams.get("day"),
                    discovery,
                    code,
                );
                await recheck();
                return json(200, result);
            }
            if (action === "map-image" && method === "GET") {
                const result = await maps.image(url.searchParams.get("token"), code);
                await recheck();
                return new Response(result.bytes, {
                    headers: { ...headers, "Content-Type": result.type },
                });
            }
            if (action === "route" && method === "POST") {
                const result = await maps.route(group.state, value, discovery);
                await recheck();
                return json(200, result);
            }
            if (action === "photos") {
                if (method === "GET" && photoId) {
                    const record = group.state.scrapbook.find((p) => p.id === photoId);
                    if (!record) fail(404, "Photo not found in this trip.");
                    const bytes = await media.get(code + "/" + photoId, {
                        type: "arrayBuffer",
                        consistency: "strong",
                    });
                    if (!bytes) fail(404, "This photo is unavailable.");
                    await recheck();
                    return new Response(bytes, {
                        headers: { ...headers, "Content-Type": record.type },
                    });
                }
                if (method !== "POST" || photoId) fail(405, "Unsupported photo request.");
                const type = request.headers.get("content-type");
                if (!["image/jpeg", "image/png"].includes(type))
                    fail(415, "Choose a JPEG or PNG photo.");
                // Stay below the platform's buffered request limit (including base64 overhead).
                const bytes = await readBody(request, 4 * 1024 * 1024);
                if (
                    !/^\d+$/.test(url.searchParams.get("revision") || "") ||
                    Number(url.searchParams.get("revision")) !== group.state.revision
                )
                    fail(409, "The plan changed. Refresh before uploading.");
                const stopId = url.searchParams.get("stopId");
                if (!group.state.stops.some((p) => p.id === stopId) || !group.state.visits[stopId])
                    fail(400, "Mark this stop as group visited before adding a memory.");
                if (
                    group.state.scrapbook.length >= 100 ||
                    group.state.scrapbook.filter((p) => p.by === memberId).length >= 40
                )
                    fail(400, "Photo allowance reached (100 per trip, 40 per member).");
                const caption = Core.text(
                    url.searchParams.get("caption") || "",
                    "Caption",
                    500,
                    false,
                );
                const processed = await processImage(bytes, type),
                    id = crypto.randomUUID() + "." + processed.details.extension;
                if (
                    group.state.scrapbook.reduce((n, p) => n + (p.size || 0), 0) +
                        processed.bytes.length >
                    200 * 1024 * 1024
                )
                    fail(400, "This trip has reached its 200 MB photo allowance.");
                await media.set(code + "/" + id, processed.bytes, { onlyIfNew: true });
                group.state.scrapbook.push({
                    ...processed.details,
                    id,
                    stopId,
                    caption,
                    by: memberId,
                    createdAt: new Date().toISOString(),
                    updatedAt: null,
                });
                group.state.revision++;
                group.state.updatedAt = new Date().toISOString();
                try {
                    await save(code, group, entry.etag);
                } catch (error) {
                    await media.delete(code + "/" + id);
                    throw error;
                }
                return json(201, { state: group.state });
            }
            if (method !== "POST" || !["commands", "invite"].includes(action))
                fail(405, "Unsupported request.");
            if (!Number.isInteger(value.revision) || value.revision !== group.state.revision)
                fail(409, "The plan changed. Refresh before saving.");
            if (action === "invite") {
                if (group.state.organizerId !== memberId)
                    fail(403, "Only the organizer manages invitations.");
                if (!["rotate", "revoke"].includes(value.action))
                    fail(400, "Choose a new invitation or revoke it.");
                const invite = value.action === "rotate" ? invitation(group) : null;
                if (!invite) group.invite.revoked = true;
                group.state.revision++;
                await save(code, group, entry.etag);
                return json(200, { state: group.state, invite, expires: group.invite.expires });
            }
            group.state = Core.apply(group.state, value, memberId);
            for (const [hash, id] of Object.entries(group.tokens))
                if (group.state.members.find((m) => m.id === id)?.removed)
                    delete group.tokens[hash];
            await save(code, group, entry.etag);
            if (value.type === "deletePhoto")
                try {
                    await media.delete(code + "/" + value.payload.id);
                } catch {
                    /* Membership state already revokes access. */
                }
            return json(200, { state: group.state });
        } catch (error) {
            return json(error.status || (error.code ? 503 : 400), {
                error:
                    error.status || !error.code
                        ? error.message
                        : "Shared storage is unavailable. Your change was not saved; try again.",
            });
        }
    };
}
module.exports = { createNetlifyApi };
