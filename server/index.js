/* Node.js 24+: transactional planning, optional verified accounts and private media. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Core = require("../shared/planner-core.js");
const { createDiscovery } = require("./services/discovery.js");
const { createMapService } = require("./services/map-service.js");
const { LIMIT: PHOTO_LIMIT, createMediaStore } = require("./services/media-store.js");
const { createPlanStore } = require("./storage/plan-store.js");
const { createAccounts } = require("./services/account-service.js");
const Profile = require("../shared/profile-rules.js");
const { resolvePublicFile } = require("./static-files.js");
const { describeIntegrations } = require("./services/integrations.js");
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
};
const digest = (token) => crypto.createHash("sha256").update(token).digest("hex");
function createPlannerServer({
    dataFile = path.join(
        process.env.PLANMATE_DATA_DIR || path.join(__dirname, "..", "data"),
        "plans.json",
    ),
    discoveryOptions,
    mapOptions,
    mediaDir = dataFile ? path.join(path.dirname(dataFile), "media") : null,
    databaseFile = dataFile ? dataFile.replace(/\.json$/, "") + ".sqlite" : null,
    accountOptions,
} = {}) {
    const discovery = createDiscovery(discoveryOptions);
    const maps = createMapService(mapOptions);
    const media = createMediaStore(mediaDir);
    const store = createPlanStore({ file: databaseFile, legacyFile: dataFile });
    let accounts;
    try {
        accounts = createAccounts(store, accountOptions);
    } catch (error) {
        store.close();
        throw error;
    }
    let database = store.snapshot();
    function persist(next) {
        database = store.commit(database, next);
    }
    function json(response, status, value) {
        response.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(value));
    }
    function fail(status, message) {
        const error = new Error(message);
        error.status = status;
        throw error;
    }
    async function body(request) {
        if (!request.headers["content-type"]?.startsWith("application/json"))
            fail(415, "Send JSON data.");
        let raw = "";
        for await (const chunk of request) {
            raw += chunk;
            if (Buffer.byteLength(raw) > 65536) fail(413, "This change is too large.");
        }
        let value;
        try {
            value = JSON.parse(raw);
        } catch {
            fail(400, "The request must contain valid JSON.");
        }
        if (!value || typeof value !== "object" || Array.isArray(value))
            fail(400, "Send a JSON object.");
        return value;
    }
    function legacyMember(request, group) {
        const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
        if (!token) fail(401, "Join this group first.");
        const memberId = group.tokens[digest(token)];
        if (
            !memberId ||
            !group.state.members.some((m) => m.id === memberId && !m.removed && !m.accountId)
        )
            fail(401, "Your membership is unavailable. Rejoin with the invitation.");
        return memberId;
    }
    function authenticate(request, group) {
        const user = accounts.session(request);
        const member =
            user && group.state.members.find((m) => m.accountId === user.id && !m.removed);
        if (member) {
            if (request.method !== "GET") accounts.csrf(request, user);
            return member.id;
        }
        if (group.accountRequired || accounts.required) {
            if (user && !group.accountRequired && request.method === "GET")
                return legacyMember(request, group);
            fail(
                401,
                "Sign in with this trip's account. Legacy members must explicitly claim their membership.",
            );
        }
        return legacyMember(request, group);
    }
    function invitation(group) {
        const key = crypto.randomBytes(24).toString("base64url");
        group.invite = { hash: digest(key), expires: Date.now() + 7 * 86400000, revoked: false };
        return key;
    }
    const buckets = new Map();
    const server = http.createServer(async (request, response) => {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
        try {
            const url = new URL(request.url, "http://localhost");
            if (url.pathname.startsWith("/api/")) {
                database = store.snapshot();
                const allowedOrigin = (accountOptions?.env ?? process.env).PUBLIC_ORIGIN;
                if (
                    allowedOrigin &&
                    request.headers.origin &&
                    request.headers.origin !== allowedOrigin
                )
                    fail(403, "Open Planmate on its configured origin.");
                const origin = request.headers.origin;
                if (origin) {
                    let originHost;
                    try {
                        originHost = new URL(origin).host;
                    } catch {
                        fail(403, "Invalid origin.");
                    }
                    if (originHost !== request.headers.host)
                        fail(403, "Open the dashboard on this server to make changes.");
                }
                const address = request.socket.remoteAddress;
                const now = Date.now();
                if (buckets.size > 5000)
                    for (const [key, bucket] of buckets)
                        if (bucket.until < now) buckets.delete(key);
                let bucket = buckets.get(address);
                if (!bucket || bucket.until < now) {
                    bucket = { count: 0, until: now + 60000 };
                    buckets.set(address, bucket);
                }
                if (++bucket.count > 600) fail(429, "Too many requests. Try again in a minute.");
                if (url.pathname.startsWith("/api/auth/"))
                    return await accounts.handle(
                        request,
                        response,
                        url.pathname.slice(10),
                        request.method === "POST" ? await body(request) : {},
                        json,
                    );
                if (url.pathname === "/api/profile") {
                    const user = accounts.session(request);
                    if (!user) fail(401, "Sign in to access your private profile.");
                    if (request.method === "GET")
                        return json(response, 200, {
                            profile: JSON.parse(user.profile),
                            revision: user.profile_revision,
                        });
                    if (request.method !== "PUT") fail(405, "Use GET or PUT for your profile.");
                    accounts.csrf(request, user);
                    const value = await body(request);
                    const currentUser = accounts.session(request);
                    accounts.csrf(request, currentUser);
                    const profile = Profile.normalise(value.profile, currentUser.name);
                    profile.updatedAt = new Date().toISOString();
                    store.transaction(() => {
                        const changed = store.db
                            .prepare(
                                "UPDATE accounts SET profile=?,name=?,profile_revision=profile_revision+1 WHERE id=? AND profile_revision=?",
                            )
                            .run(JSON.stringify(profile), profile.name, user.id, value.revision);
                        if (!changed.changes)
                            fail(
                                409,
                                "Your profile changed on another device. Reload it before saving; your input is still here.",
                            );
                    });
                    return json(response, 200, { profile, revision: user.profile_revision + 1 });
                }
                if (url.pathname === "/api/my-trips" && request.method === "GET") {
                    const user = accounts.session(request);
                    if (!user) fail(401, "Sign in to see your trips.");
                    return json(response, 200, {
                        trips: Object.entries(database.groups).flatMap(([code, g]) => {
                            const m = g.state.members.find(
                                (m) => m.accountId === user.id && !m.removed,
                            );
                            return m ? [{ code, memberId: m.id, title: g.state.trip.title }] : [];
                        }),
                    });
                }
                if (url.pathname === "/api/health" && request.method === "GET")
                    return json(response, 200, {
                        ok: true,
                        mode: accounts.required ? "accounts-required" : "guest",
                        storage: "sqlite-single-host",
                        verifiedSignInConfigured: accounts.configured,
                        planningFeatures: 2,
                    });
                if (url.pathname === "/api/integrations/status" && request.method === "GET")
                    return json(
                        response,
                        200,
                        describeIntegrations({
                            accounts: {
                                configured: accounts.configured,
                                required: accounts.required,
                            },
                            discovery: discovery.config(),
                            maps: maps.config(),
                        }),
                    );
                if (url.pathname.startsWith("/api/discovery/")) {
                    if (request.method !== "GET") fail(405, "Discovery accepts GET requests.");
                    const action = url.pathname.slice("/api/discovery/".length);
                    if (action === "config") return json(response, 200, discovery.config());
                    if (accounts.required && !accounts.session(request))
                        fail(401, "Sign in before using connected discovery.");
                    if (!["places", "events", "photo", "details"].includes(action))
                        fail(404, "Discovery endpoint not found.");
                    // A separate allowance bounds billable searches without
                    // blocking friends' planning updates or lazy photo loads.
                    if (action !== "photo") {
                        const bucketKey = `discovery:${address}`;
                        let discoveryBucket = buckets.get(bucketKey);
                        if (!discoveryBucket || discoveryBucket.until < now) {
                            discoveryBucket = { count: 0, until: now + 60000 };
                            buckets.set(bucketKey, discoveryBucket);
                        }
                        if (++discoveryBucket.count > 30)
                            fail(429, "Too many discovery searches. Try again in a minute.");
                    }
                    if (action === "photo") {
                        const target = await discovery.photo(url.searchParams);
                        response.writeHead(302, { Location: target, "Cache-Control": "no-store" });
                        return response.end();
                    }
                    return json(response, 200, await discovery[action](url.searchParams));
                }
                if (url.pathname === "/api/groups" && request.method === "POST") {
                    const value = await body(request);
                    database = store.snapshot();
                    const user = accounts.session(request);
                    if (user || accounts.required) accounts.csrf(request, user);
                    if (Object.keys(database.groups).length >= 100)
                        fail(
                            400,
                            "The shared trip limit has been reached. Contact the site administrator.",
                        );
                    const name = Core.text(value.name, "Name", 60),
                        code = crypto.randomBytes(12).toString("base64url");
                    const token = crypto.randomBytes(32).toString("base64url"),
                        memberId = crypto.randomUUID();
                    const state = Core.createState(value.trip, { id: memberId, name });
                    if (user) state.members[0].accountId = user.id;
                    const next = Core.clone(database);
                    next.groups[code] = {
                        state,
                        accountRequired: Boolean(user),
                        tokens: user ? {} : { [digest(token)]: memberId },
                    };
                    const invite = invitation(next.groups[code]);
                    persist(next);
                    return json(response, 201, {
                        code,
                        token: user ? null : token,
                        memberId,
                        state,
                        invite,
                    });
                }
                const match = url.pathname.match(
                    /^\/api\/groups\/([A-Za-z0-9_-]{16})(?:\/(join|commands|claim|invite|map|map-image|route|photos)(?:\/([0-9a-f-]{36}\.(?:jpg|png)))?)?$/,
                );
                if (!match) fail(404, "Planning endpoint not found.");
                const [, code, action, photoId] = match;
                if (action === "photos") {
                    let group = database.groups[code];
                    if (!group) fail(404, "Trip not found.");
                    const memberId = authenticate(request, group);
                    if (request.method === "GET" && photoId) {
                        const record = group.state.scrapbook?.find((p) => p.id === photoId);
                        if (!record) fail(404, "Photo not found in this trip.");
                        let bytes;
                        try {
                            bytes = media.read(code, photoId);
                        } catch (error) {
                            if (error.code === "ENOENT")
                                fail(
                                    404,
                                    "This uploaded photo file is missing. Restore it from a backup or ask its author to upload it again.",
                                );
                            throw error;
                        }
                        response.writeHead(200, {
                            "Content-Type": record.type,
                            "Cache-Control": "private, no-store",
                            "Content-Disposition": "inline",
                        });
                        return response.end(bytes);
                    }
                    if (request.method !== "POST" || photoId)
                        fail(405, "Unsupported photo request.");
                    const type = request.headers["content-type"]?.split(";")[0];
                    if (!["image/jpeg", "image/png"].includes(type))
                        fail(415, "Choose a JPEG or PNG photo.");
                    if (Number(request.headers["content-length"]) > PHOTO_LIMIT)
                        fail(413, "Photo must be 5 MB or smaller.");
                    const chunks = [];
                    let size = 0;
                    for await (const chunk of request) {
                        size += chunk.length;
                        if (size > PHOTO_LIMIT) fail(413, "Photo must be 5 MB or smaller.");
                        chunks.push(chunk);
                    }
                    database = store.snapshot();
                    group = database.groups[code];
                    authenticate(request, group);
                    const rawRevision = url.searchParams.get("revision");
                    if (!/^\d+$/.test(rawRevision || ""))
                        fail(400, "Include the current plan revision.");
                    const state = Core.migrate(group.state),
                        revision = Number(rawRevision);
                    if (revision !== state.revision)
                        fail(409, "The plan changed. Refresh before uploading.");
                    const stopId = url.searchParams.get("stopId"),
                        stop = state.stops.find((p) => p.id === stopId);
                    if (!stop || !state.visits[stopId])
                        fail(400, "Mark this stop as group visited before adding a memory.");
                    if (state.scrapbook.length >= 100)
                        fail(400, "This trip has reached 100 photos.");
                    if (
                        state.scrapbook.reduce((n, p) => n + (p.size || 0), 0) + size >
                        200 * 1024 * 1024
                    )
                        fail(400, "This trip has reached its 200 MB photo storage allowance.");
                    const caption = Core.text(
                            url.searchParams.get("caption") || "",
                            "Caption",
                            500,
                            false,
                        ),
                        record = await media.write(code, Buffer.concat(chunks), type);
                    database = store.snapshot();
                    group = database.groups[code];
                    try {
                        authenticate(request, group);
                        if (group.state.revision !== revision)
                            fail(
                                409,
                                "The plan changed while processing your photo. Your file has not been attached.",
                            );
                    } catch (e) {
                        media.remove(code, record.id);
                        throw e;
                    }
                    const entry = {
                        ...record,
                        stopId,
                        by: memberId,
                        caption,
                        createdAt: new Date().toISOString(),
                        updatedAt: null,
                    };
                    if (
                        group.state.scrapbook.reduce((n, p) => n + (p.size || 0), 0) + record.size >
                            200 * 1024 * 1024 ||
                        group.state.scrapbook.filter((p) => p.by === memberId).length >= 40 ||
                        Object.values(database.groups).reduce(
                            (n, g) =>
                                n +
                                (g.state.scrapbook || []).reduce((v, p) => v + (p.size || 0), 0),
                            0,
                        ) +
                            record.size >
                            2 * 1024 * 1024 * 1024
                    ) {
                        media.remove(code, record.id);
                        fail(
                            400,
                            "Photo storage allowance reached (40 per member, 200 MB per trip, 2 GB per server).",
                        );
                    }
                    state.scrapbook.push(entry);
                    state.revision++;
                    state.updatedAt = entry.createdAt;
                    const next = Core.clone(database);
                    next.groups[code].state = state;
                    try {
                        persist(next);
                    } catch (e) {
                        media.remove(code, record.id);
                        throw e;
                    }
                    return json(response, 201, { state });
                }
                if (photoId) fail(404, "Endpoint not found.");
                if (["map", "map-image", "route"].includes(action)) {
                    const group = database.groups[code];
                    if (!group) fail(404, "Trip not found.");
                    authenticate(request, group);
                    if (action !== "map-image") {
                        const key = `maps:${address}`;
                        let quota = buckets.get(key);
                        if (!quota || quota.until < now) {
                            quota = { count: 0, until: now + 60000 };
                            buckets.set(key, quota);
                        }
                        if (++quota.count > 6)
                            fail(429, "Too many map or route refreshes. Try again in a minute.");
                    }
                    const checkCurrentAccess = () => {
                        database = store.snapshot();
                        if (!database.groups[code]) fail(404, "Trip not found.");
                        authenticate(request, database.groups[code]);
                    };
                    if (action === "map" && request.method === "GET") {
                        const result = await maps.map(
                            Core.migrate(group.state),
                            url.searchParams.get("day"),
                            discovery,
                            code,
                        );
                        checkCurrentAccess();
                        return json(response, 200, result);
                    }
                    if (action === "map-image" && request.method === "GET") {
                        const image = await maps.image(url.searchParams.get("token"), code);
                        checkCurrentAccess();
                        response.writeHead(200, {
                            "Content-Type": image.type,
                            "Cache-Control": "no-store",
                        });
                        return response.end(image.bytes);
                    }
                    if (action === "route" && request.method === "POST") {
                        const payload = await body(request);
                        checkCurrentAccess();
                        const result = await maps.route(
                            Core.migrate(database.groups[code].state),
                            payload,
                            discovery,
                        );
                        checkCurrentAccess();
                        return json(response, 200, result);
                    }
                    fail(405, "Unsupported map request.");
                }
                if (!action && request.method === "GET") {
                    const group = database.groups[code];
                    if (!group) fail(404, "This planning space was not found.");
                    const memberId = authenticate(request, group);
                    return json(response, 200, { state: Core.migrate(group.state), memberId });
                }
                if (request.method !== "POST" || !action)
                    fail(405, "That request method is not supported.");
                // Re-read the database after awaiting the body, then validate and commit synchronously.
                // Concurrent requests cannot silently replace one another's changes.
                const value = await body(request);
                database = store.snapshot();
                const group = database.groups[code];
                if (!group) fail(404, "This planning space was not found.");
                if (action === "claim") {
                    const user = accounts.session(request);
                    accounts.csrf(request, user);
                    if (value.consent !== true)
                        fail(
                            400,
                            "Explicitly agree to bind this legacy membership to your verified account.",
                        );
                    const id = legacyMember(request, group);
                    if (value.revision !== group.state.revision)
                        fail(409, "The plan changed. Refresh before claiming membership.");
                    if (group.state.members.some((m) => m.accountId === user.id))
                        fail(
                            409,
                            "This account already has a membership. No duplicate was created.",
                        );
                    const next = Core.clone(database),
                        target = next.groups[code];
                    target.state.members.find((m) => m.id === id).accountId = user.id;
                    for (const [k, v] of Object.entries(target.tokens))
                        if (v === id) delete target.tokens[k];
                    target.state.revision++;
                    target.state.updatedAt = new Date().toISOString();
                    persist(next);
                    return json(response, 200, {
                        state: target.state,
                        memberId: id,
                        claimed: true,
                    });
                }
                if (action === "invite") {
                    const id = authenticate(request, group);
                    if (group.state.organizerId !== id)
                        fail(403, "Only the organizer manages invitations.");
                    if (value.revision !== group.state.revision)
                        fail(409, "The plan changed. Refresh before changing invitations.");
                    const next = Core.clone(database),
                        target = next.groups[code];
                    if (!["rotate", "revoke"].includes(value.action))
                        fail(400, "Choose a new invitation or revoke it.");
                    const invite = value.action === "rotate" ? invitation(target) : null;
                    if (!invite) target.invite = { ...target.invite, revoked: true };
                    target.state.revision++;
                    persist(next);
                    return json(response, 200, {
                        state: target.state,
                        invite,
                        expires: target.invite.expires,
                    });
                }
                if (action === "join") {
                    const user = accounts.session(request);
                    if (user || group.accountRequired || accounts.required)
                        accounts.csrf(request, user);
                    const existing =
                        user && group.state.members.find((m) => m.accountId === user.id);
                    if (existing) {
                        if (existing.removed)
                            fail(
                                403,
                                "Your membership was removed. Ask the organizer about access.",
                            );
                        return json(response, 200, {
                            code,
                            token: null,
                            memberId: existing.id,
                            state: Core.migrate(group.state),
                        });
                    }
                    if (
                        group.invite &&
                        (group.invite.revoked ||
                            group.invite.expires <= Date.now() ||
                            digest(String(value.invite || "")) !== group.invite.hash)
                    )
                        fail(
                            403,
                            "This invitation is missing, expired or revoked. Ask the organizer for a new link.",
                        );
                    if ((group.accountRequired || accounts.required) && !group.invite)
                        fail(
                            403,
                            "The organizer needs to create an invitation for this legacy trip.",
                        );
                    if (
                        group.state.members.filter((m) => !m.removed).length >= 30 ||
                        group.state.members.length >= 100
                    )
                        fail(400, "This group has reached 30 planners.");
                    const name = Core.text(value.name, "Name", 60),
                        memberId = crypto.randomUUID(),
                        token = crypto.randomBytes(32).toString("base64url");
                    const next = Core.clone(database),
                        target = next.groups[code];
                    target.state = Core.migrate(target.state);
                    target.state.members.push({
                        id: memberId,
                        name,
                        ...(user ? { accountId: user.id } : {}),
                    });
                    if (!user) target.tokens[digest(token)] = memberId;
                    target.state.revision += 1;
                    target.state.updatedAt = new Date().toISOString();
                    persist(next);
                    return json(response, 201, {
                        code,
                        token: user ? null : token,
                        memberId,
                        state: target.state,
                    });
                }
                const memberId = authenticate(request, group);
                if (!Number.isInteger(value.revision) || value.revision !== group.state.revision)
                    fail(409, "The plan changed. Refresh it before saving.");
                const state = Core.apply(group.state, value, memberId),
                    next = Core.clone(database);
                next.groups[code].state = state;
                if (value.type === "removeMember" || value.type === "leaveTrip")
                    for (const [k, id] of Object.entries(next.groups[code].tokens))
                        if (state.members.find((m) => m.id === id)?.removed)
                            delete next.groups[code].tokens[k];
                persist(next);
                if (value.type === "deletePhoto") {
                    // State revokes access first. A failed cleanup leaves only an inaccessible orphan file.
                    try {
                        media.remove(code, value.payload.id);
                    } catch {
                        /* A later storage cleanup can remove an orphan. */
                    }
                }
                return json(response, 200, { state });
            }
            if (request.method !== "GET" && request.method !== "HEAD")
                fail(405, "That request method is not supported.");
            const file = url.pathname === "/" ? "login.html" : url.pathname.slice(1);
            const resource = resolvePublicFile(file);
            if (!resource) {
                response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                return response.end("Page not found.");
            }
            const contents = fs.readFileSync(resource.absolute);
            response.writeHead(200, {
                "Content-Type": MIME[path.extname(file)],
                "Cache-Control": "no-cache",
            });
            response.end(request.method === "HEAD" ? undefined : contents);
        } catch (error) {
            if (!response.headersSent)
                json(response, error.status || (error.code ? 500 : 400), {
                    error: error.code
                        ? "The server could not save this change. Try again."
                        : error.message,
                });
            else response.end();
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.on("close", () => store.close());
    return server;
}
function start() {
    const port = Number(process.env.PORT || 3000),
        host = process.env.HOST || (process.argv.includes("--lan") ? "0.0.0.0" : "127.0.0.1");
    const server = createPlannerServer();
    server.on("error", (error) => {
        console.error(`Could not start Planmate: ${error.message}`);
        process.exitCode = 1;
    });
    server.listen(port, host, () =>
        console.log(
            `Planmate is ready at http://localhost:${port}/dashboard.html\n${host === "0.0.0.0" ? "LAN mode: friends on your network can use this computer’s network address." : "Local mode: use separate browsers to try shared planning. pnpm run start:lan enables other devices."}`,
        ),
    );
    return server;
}
if (require.main === module) start();
module.exports = { createPlannerServer, start };
