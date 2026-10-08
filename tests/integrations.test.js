"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    path = require("node:path"),
    { createPlannerServer } = require("./server-fixture"),
    { createMapService } = require("../server/services/map-service"),
    { checkLaunch } = require("../scripts/check-launch"),
    { aliases, resolvePublicFile } = require("../server/static-files");

const state = () => ({
    trip: { timezone: "Asia/Kolkata" },
    stops: [
        {
            id: "a",
            place: {
                coordinates: {
                    latitude: 15.5,
                    longitude: 73.8,
                    source: "https://example.test/location",
                },
            },
        },
        {
            id: "b",
            date: "2026-10-10",
            start: "18:00",
            travel: 20,
            place: {
                coordinates: {
                    latitude: 15.6,
                    longitude: 73.9,
                    source: "https://example.test/location",
                },
            },
        },
    ],
});
test("Google Routes uses the official server endpoint, bounded field mask and sourced locations without changing manual buffers", async () => {
    let sent;
    const s = state(),
        original = JSON.stringify(s);
    const maps = createMapService({
        env: { GOOGLE_ROUTES_API_KEY: "secret-route-key" },
        now: () => 0,
        fetchImpl: async (url, options) => {
            sent = { url, ...options };
            return Response.json({ routes: [{ duration: "600.5s", distanceMeters: 3000 }] });
        },
    });
    const route = await maps.route(s, { fromId: "a", toId: "b" }, {});
    assert.equal(sent.url, "https://routes.googleapis.com/directions/v2:computeRoutes");
    assert.equal(sent.headers["X-Goog-Api-Key"], "secret-route-key");
    assert.equal(sent.headers["X-Goog-FieldMask"], "routes.duration,routes.distanceMeters");
    assert.deepEqual(JSON.parse(sent.body).origin.location.latLng, {
        latitude: 15.5,
        longitude: 73.8,
    });
    assert.equal(JSON.parse(sent.body).routingPreference, "TRAFFIC_UNAWARE");
    assert.equal(route.durationSeconds, 600.5);
    assert.equal(route.distanceMeters, 3000);
    assert.match(route.provider, /without traffic/);
    assert.equal(new URL(route.sourceUrl).searchParams.get("api"), "1");
    assert.equal(JSON.stringify(s), original);
    assert.ok(!JSON.stringify({ config: maps.config(), route }).includes("secret-route-key"));
});
test("Google route failures, no route and malformed durations never become invented travel estimates", async () => {
    const results = [
        new Response("Denied", { status: 403 }),
        Response.json({ routes: [] }),
        Response.json({ routes: [{ duration: "unknown", distanceMeters: 30 }] }),
        Response.json({ routes: [{ duration: "600s", distanceMeters: -1 }] }),
        new Response("not JSON", { status: 200 }),
    ];
    for (const result of results) {
        const maps = createMapService({
            env: { GOOGLE_ROUTES_API_KEY: "key" },
            fetchImpl: async () => result,
        });
        await assert.rejects(maps.route(state(), { fromId: "a", toId: "b" }, {}));
    }
    const maps = createMapService({
        env: { GOOGLE_ROUTES_API_KEY: "key" },
        fetchImpl: async () => {
            throw new Error("network");
        },
    });
    await assert.rejects(maps.route(state(), { fromId: "a", toId: "b" }, {}), /unreachable/);
    const missing = state();
    delete missing.stops[1].place.coordinates;
    await assert.rejects(
        maps.route(missing, { fromId: "a", toId: "b" }, {}),
        /Coordinates are missing/,
    );
});
test("an existing authorized route feed takes precedence over a Google route key", async () => {
    let called;
    const maps = createMapService({
        env: { GOOGLE_ROUTES_API_KEY: "key", ROUTES_FEED_URL: "https://feed.example.test/routes" },
        fetchImpl: async (url) => {
            called = url;
            return Response.json({
                durationSeconds: 100,
                distanceMeters: 400,
                provider: "Feed",
                sourceUrl: "https://feed.example.test/source",
            });
        },
    });
    assert.equal((await maps.route(state(), { fromId: "a", toId: "b" }, {})).provider, "Feed");
    assert.equal(called, "https://feed.example.test/routes");
});
test("public connection status reports configuration only, protects credentials, and required mode protects discovery", async () => {
    let calls = 0;
    const server = createPlannerServer({
        accountOptions: {
            env: {
                GOOGLE_CLIENT_ID: "123-test.apps.googleusercontent.com",
                ACCOUNT_MODE: "required",
            },
        },
        discoveryOptions: {
            env: { GOOGLE_PLACES_API_KEY: "places-secret", EVENTS_FEED_TOKEN: "event-secret" },
            fetchImpl: async () => {
                calls++;
                throw new Error("Should not call");
            },
        },
        mapOptions: {
            env: {
                GOOGLE_ROUTES_API_KEY: "route-secret",
                GOOGLE_STATIC_MAPS_API_KEY: "maps-secret",
            },
            fetchImpl: async () => {
                calls++;
                throw new Error("Should not call");
            },
        },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(origin + "/api/integrations/status");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const data = await response.json();
        assert.equal(data.liveVerified, false);
        assert.equal(data.services.length, 5);
        assert.equal(
            data.services.find((s) => s.id === "routes").status,
            "Configured · live check needed",
        );
        assert.equal(data.services.find((s) => s.id === "events").configured, false);
        assert.ok(!JSON.stringify(data).includes("secret"));
        assert.equal((await fetch(origin + "/api/discovery/places?city=Goa")).status, 401);
        assert.equal(calls, 0);
        const page = await fetch(origin + "/login.html");
        assert.equal(page.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
        assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
test("old public asset URLs resolve after organization while server modules and traversal stay private", async () => {
    const server = createPlannerServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const [old, canonical] of Object.entries(aliases)) {
            const response = await fetch(origin + "/" + old);
            assert.equal(response.status, 200, old);
            assert.equal(
                await response.text(),
                await (await fetch(origin + "/" + canonical)).text(),
            );
        }
        for (const file of [
            "server/index.js",
            "server/services/discovery.js",
            "server/storage/plan-store.js",
            "docs/API-CONNECTIONS.md",
            "../.env",
            "shared/../server/index.js",
        ])
            assert.equal((await fetch(origin + "/" + file)).status, 404, file);
        assert.equal(resolvePublicFile("../server/index.js"), null);
        assert.equal(
            require("../server.js").createPlannerServer,
            require("../server/index.js").createPlannerServer,
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
test("public preflight finds deployment blockers and accepts complete settings without needing optional providers", () => {
    const empty = checkLaunch({});
    assert.ok(empty.errors.length >= 4);
    const complete = {
        HOST: "0.0.0.0",
        PUBLIC_ORIGIN: "https://planmate.example.test",
        SESSION_SECURE: "true",
        ACCOUNT_MODE: "required",
        GOOGLE_CLIENT_ID: "123-demo.apps.googleusercontent.com",
        PLANMATE_DATA_DIR: path.resolve(__dirname, "..", "data"),
        PORT: "3000",
    };
    assert.deepEqual(checkLaunch(complete).errors, []);
    assert.ok(checkLaunch(complete).warnings.some((message) => message.includes("unconfigured")));
    for (const partial of [
        { PUBLIC_ORIGIN: "https://example.test/path" },
        { PUBLIC_ORIGIN: "http://example.test" },
        { SESSION_SECURE: "false" },
        { PORT: "3.14" },
        { ROUTES_FEED_URL: "http://example.test" },
        { EVENTS_FEED_URL: "https://user:private@example.test" },
        { PLANMATE_DATA_DIR: path.resolve(__dirname, "..", "public", "data") },
    ]) {
        const result = checkLaunch({ ...complete, ...partial });
        assert.ok(result.errors.length);
        assert.ok(!JSON.stringify(result).includes("private@example"));
    }
});
