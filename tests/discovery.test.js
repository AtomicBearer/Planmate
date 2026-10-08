"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDiscovery } = require("../discovery");
const { createPlannerServer } = require("./server-fixture");
const Core = require("../planner-core");
const time = Date.parse("2026-10-08T10:00:00Z");
const params = (values) => new URLSearchParams(values);
const ok = (value) => ({ ok: true, json: async () => value });
const row = (id) => ({
    id,
    displayName: { text: `Venue ${id}` },
    formattedAddress: "Anjuna, Goa, India",
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    photos: [
        {
            name: `places/${id}/photos/photo_${id}`,
            authorAttributions: [
                { displayName: "Photographer", uri: "https://maps.google.com/contributor/123" },
            ],
        },
    ],
});
test("Goa pilot categories use explicit India queries, omit missing photos and invalid coordinates, and explain empty results", async () => {
    const queries = [];
    const discovery = createDiscovery({
        env: { GOOGLE_PLACES_API_KEY: "fixture" },
        fetchImpl: async (url, options) => {
            queries.push(JSON.parse(options.body));
            return ok({
                places:
                    queries.length === 1
                        ? [
                              {
                                  ...row("beach"),
                                  photos: [],
                                  location: { latitude: 99, longitude: 1 },
                              },
                              row("beach"),
                          ]
                        : [],
            });
        },
    });
    const beach = await discovery.places(params({ city: "Goa", category: "Beach", q: "beaches" }));
    assert.equal(beach.places.length, 1);
    assert.equal(beach.places[0].photoUrl, "");
    assert.equal(beach.places[0].coordinates, undefined);
    assert.equal(beach.places[0].category, "Beach");
    const empty = await discovery.places(
        params({ city: "Goa", category: "Nightlife", q: "night clubs" }),
    );
    assert.deepEqual(empty.places, []);
    assert.match(empty.notice, /does not establish/);
    assert.equal(empty.cursor, "");
    assert.equal(queries[0].textQuery, "beaches in Goa, India");
    assert.equal(queries[1].regionCode, "IN");
});
test("pilot command does not issue billable requests when unconfigured or without live opt-in", async () => {
    const { pilot } = require("../scripts/pilot-goa");
    let calls = 0;
    const discovery = {
        config: () => ({ places: true, events: false }),
        places: async () => {
            calls++;
            return { places: [], cursor: "" };
        },
    };
    const configuration = await pilot({ discovery });
    assert.equal(calls, 0);
    assert.equal(configuration.liveVerified, false);
    const live = await pilot({ live: true, discovery });
    assert.equal(calls, 3);
    assert.equal(live.liveVerified, false);
    assert.equal(live.checks.length, 3);
    const offline = await pilot({ live: true, discovery: { config: () => ({ places: false }) } });
    assert.match(offline.note, /unconfigured/);
});

test("city discovery spans 200+ distinct venues with bounded batches and stable deduplication", async () => {
    let calls = 0;
    const discovery = createDiscovery({
        env: { GOOGLE_PLACES_API_KEY: "server-secret" },
        now: () => time,
        fetchImpl: async (url, options) => {
            calls++;
            assert.equal(options.headers["X-Goog-Api-Key"], "server-secret");
            const query = JSON.parse(options.body).textQuery.replace(/[^a-z]/gi, "");
            return ok({
                places: [
                    row("duplicate"),
                    ...Array.from({ length: 19 }, (_, i) => row(`${query}_${i}`)),
                ],
            });
        },
    });
    const ids = new Set();
    let cursor = "",
        batches = 0;
    do {
        const before = calls,
            result = await discovery.places(
                params({ city: "Goa", category: "All", ...(cursor ? { cursor } : {}) }),
            );
        assert.ok(calls - before <= 3);
        for (const place of result.places) {
            assert.ok(!ids.has(place.id));
            ids.add(place.id);
            assert.ok(place.photoUrl);
        }
        cursor = result.cursor;
        batches++;
    } while (cursor && batches < 20);
    assert.ok(ids.size >= 200);
    assert.equal(cursor, "");
    assert.equal(calls, 16);
});
test("specific searches follow provider pagination and expire their cursors", async () => {
    let clock = time;
    const bodies = [];
    const discovery = createDiscovery({
        env: { GOOGLE_PLACES_API_KEY: "key" },
        now: () => clock,
        fetchImpl: async (url, options) => {
            const body = JSON.parse(options.body);
            bodies.push(body);
            return ok({
                places: [row(body.pageToken || "first")],
                nextPageToken: body.pageToken ? "" : "second",
            });
        },
    });
    const first = await discovery.places(params({ city: "Goa", q: "seafood" }));
    await assert.rejects(
        discovery.places(params({ city: "Mumbai", q: "seafood", cursor: first.cursor })),
        { status: 410 },
    );
    const second = await discovery.places(
        params({ city: "Goa", q: "seafood", cursor: first.cursor }),
    );
    assert.equal(bodies[1].pageToken, "second");
    assert.equal(second.cursor, "");
    const third = await discovery.places(params({ city: "Goa", q: "seafood" }));
    clock += 600001;
    await assert.rejects(
        discovery.places(params({ city: "Goa", q: "seafood", cursor: third.cursor })),
        { status: 410 },
    );
});
test("partial provider failures retain a retry cursor while total failure is explicit", async () => {
    let mode = "partial";
    const discovery = createDiscovery({
        env: { GOOGLE_PLACES_API_KEY: "key" },
        fetchImpl: async (url, options) =>
            mode === "all" || JSON.parse(options.body).textQuery.startsWith("beaches")
                ? { ok: false, status: 429 }
                : ok({ places: [row("unique")] }),
    });
    const result = await discovery.places(params({ city: "Goa" }));
    assert.equal(result.warnings.length, 1);
    assert.ok(result.cursor);
    assert.equal(result.places.length, 1);
    mode = "all";
    await assert.rejects(discovery.places(params({ city: "Goa", cursor: result.cursor })), {
        status: 502,
    });
});
test("photos use signed expiring references and never expose provider credentials", async () => {
    let clock = time,
        calls = 0;
    const discovery = createDiscovery({
        env: { GOOGLE_PLACES_API_KEY: "secret-key" },
        now: () => clock,
        fetchImpl: async (url) => {
            calls++;
            return ok(
                url.includes("/media?")
                    ? { photoUri: "https://lh3.googleusercontent.com/venue.jpg" }
                    : { places: [row("photo")] },
            );
        },
    });
    const result = await discovery.places(params({ city: "Goa", q: "beach" }));
    assert.equal(JSON.stringify(result).includes("secret-key"), false);
    const token = new URL(result.places[0].photoUrl, "http://local").searchParams.get("token");
    assert.equal(
        await discovery.photo(params({ token })),
        "https://lh3.googleusercontent.com/venue.jpg",
    );
    const before = calls;
    await assert.rejects(discovery.photo(params({ token: token + "x" })), { status: 403 });
    assert.equal(calls, before);
    clock += 600001;
    await assert.rejects(discovery.photo(params({ token })), { status: 410 });
});
test("Google selections store IDs and user planning labels without copying provider photos or addresses", async () => {
    const discovery = createDiscovery({
        env: { GOOGLE_PLACES_API_KEY: "key" },
        fetchImpl: async () => ok({ places: [row("place")] }),
    });
    const result = await discovery.places(params({ city: "Goa", q: "cafe" }));
    const selected = Core.place({ ...result.places[0], label: "Our lunch stop" });
    assert.equal(selected.name, "Our lunch stop");
    assert.equal(selected.label, "Our lunch stop");
    assert.equal(selected.area, "Goa");
    assert.ok(!("photoUrl" in selected));
    assert.ok(!("photoAttributions" in selected));
    assert.equal(JSON.stringify(selected).includes("Anjuna"), false);
    assert.deepEqual(Core.place(selected), selected);
});
test("authorised event feed filters city, dates, cancellations, duplicates, keywords and event types", async () => {
    const event = {
        id: "one",
        name: "Anjuna Comedy Night",
        city: "Goa",
        venue: "Test venue",
        date: "2026-10-09",
        time: "20:00",
        type: "Comedy",
        ticketUrl: "https://organiser.example/show",
        image: "https://organiser.example/poster.jpg",
    };
    const rows = [
        event,
        event,
        { ...event, id: "ongoing", date: "2026-10-07", endDate: "2026-10-10" },
        { ...event, id: "expired", date: "2026-10-07" },
        { ...event, id: "cancelled", status: "cancelled" },
        { ...event, id: "other-city", city: "Pune" },
        { ...event, id: "too-late", date: "2026-10-12" },
        { ...event, id: "wrong-type", type: "Music" },
        { ...event, id: "bad-link", ticketUrl: "javascript:alert(1)" },
        { ...event, id: "", name: "Missing identifier" },
    ];
    const discovery = createDiscovery({
        env: { EVENTS_FEED_URL: "https://feed.example/events", EVENTS_FEED_TOKEN: "private-token" },
        now: () => time,
        fetchImpl: async (url, options) => {
            assert.equal(options.headers.Authorization, "Bearer private-token");
            assert.equal(new URL(url).searchParams.get("city"), "Goa");
            return ok({ events: rows, nextPage: 1 });
        },
    });
    const result = await discovery.events(
        params({ city: "Goa", from: "2026-10-09", to: "2026-10-11", q: "comedy", type: "Comedy" }),
    );
    assert.deepEqual(
        result.events.map((e) => e.id),
        ["feed-one", "feed-ongoing"],
    );
    assert.equal(result.nextPage, 1);
    assert.equal(result.events[0].eventTime, "20:00");
    assert.equal(result.events[0].imageUrl, event.image);
    assert.equal(JSON.stringify(result).includes("private-token"), false);
    await assert.rejects(
        discovery.events(params({ city: "Goa", from: "2026-10-11", to: "2026-10-09" })),
        { status: 400 },
    );
});
test("dated event suggestions and schedule edits retain the actual event day and start time", () => {
    const trip = {
        title: "Goa",
        city: "Goa",
        start: "2026-10-09",
        end: "2026-10-11",
        budget: 5000,
    };
    const place = {
        id: "feed-event",
        name: "Comedy",
        city: "Goa",
        category: "Event",
        eventDate: "2026-10-10",
        eventTime: "20:00",
        eventType: "Comedy",
        source: "https://example.com/event",
    };
    let state = Core.createState(trip, { id: "you", name: "You" });
    state = Core.apply(state, { type: "propose", payload: { id: "idea", place } }, "you");
    assert.equal(state.proposals[0].preferredDate, "2026-10-10");
    assert.throws(
        () =>
            Core.apply(
                state,
                {
                    type: "propose",
                    payload: {
                        id: "second",
                        place: { ...place, id: "other" },
                        preferredDate: "2026-10-09",
                    },
                },
                "you",
            ),
        /actual dates/,
    );
    const slot = {
        id: "stop",
        proposalId: "idea",
        date: "2026-10-10",
        start: "20:00",
        end: "22:00",
    };
    assert.throws(
        () =>
            Core.apply(
                state,
                { type: "schedule", payload: { ...slot, date: "2026-10-11" } },
                "you",
            ),
        /actual dates/,
    );
    assert.throws(
        () => Core.apply(state, { type: "schedule", payload: { ...slot, start: "19:00" } }, "you"),
        /published start time/,
    );
    state = Core.apply(state, { type: "schedule", payload: slot }, "you");
    assert.throws(
        () =>
            Core.apply(
                state,
                { type: "editStop", payload: { ...slot, date: "2026-10-11" } },
                "you",
            ),
        /actual dates/,
    );
});
test("Ticketmaster uses IST date boundaries and retains actual classifications and event times", async () => {
    const discovery = createDiscovery({
        env: { TICKETMASTER_API_KEY: "ticket-secret" },
        now: () => time,
        fetchImpl: async (url) => {
            const query = new URL(url).searchParams;
            assert.equal(query.get("classificationName"), "Comedy");
            assert.equal(
                query.get("startEndDateTime"),
                "2026-10-08T18:30:00Z,2026-10-11T18:29:59Z",
            );
            assert.equal(query.get("countryCode"), "IN");
            return ok({
                _embedded: {
                    events: [
                        {
                            id: "comedy",
                            name: "Comedy night",
                            url: "https://www.ticketmaster.com/event/comedy",
                            dates: {
                                start: { localDate: "2026-10-10", localTime: "20:00:00" },
                                status: { code: "onsale" },
                            },
                            classifications: [
                                { segment: { name: "Arts & Theatre" }, genre: { name: "Comedy" } },
                            ],
                            _embedded: { venues: [{ name: "Venue", city: { name: "Goa" } }] },
                        },
                        {
                            id: "music",
                            name: "Music show",
                            url: "https://www.ticketmaster.com/event/music",
                            dates: { start: { localDate: "2026-10-10" } },
                            classifications: [{ segment: { name: "Music" } }],
                            _embedded: { venues: [{ city: { name: "Goa" } }] },
                        },
                    ],
                },
                page: { totalPages: 2 },
            });
        },
    });
    const result = await discovery.events(
        params({ city: "Goa", from: "2026-10-09", to: "2026-10-11", type: "Comedy" }),
    );
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].eventType, "Comedy");
    assert.equal(result.events[0].eventTime, "20:00");
    assert.equal(result.nextPage, 1);
    assert.equal(JSON.stringify(result).includes("ticket-secret"), false);
});
test("unconfigured discovery stays explicit and internal configuration is not publicly served", async () => {
    const server = createPlannerServer({
        dataFile: null,
        discoveryOptions: {
            env: {},
            fetchImpl: async () => {
                throw new Error("Should not fetch");
            },
        },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const config = await (await fetch(base + "/api/discovery/config")).json();
        assert.equal(config.places, false);
        assert.equal(config.events, false);
        assert.equal((await fetch(base + "/api/discovery/places?city=Goa")).status, 503);
        assert.equal((await fetch(base + "/api/discovery/events?city=Goa")).status, 503);
        assert.equal((await fetch(base + "/discovery.js")).status, 404);
        assert.equal((await fetch(base + "/.env.example")).status, 404);
        assert.equal(
            (
                await fetch(base + "/api/discovery/config", {
                    headers: { Origin: "https://untrusted.example" },
                })
            ).status,
            403,
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
