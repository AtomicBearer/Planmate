"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    C = require("../shared/planner-core.js"),
    catalogue = require("../shared/catalogue.js"),
    { createMapService } = require("../server/services/map-service.js");
const act = (s, type, payload = {}, id = "a") => C.apply(s, { type, payload }, id);
function fresh() {
    let s = C.createState(
        {
            title: "Interactive Goa",
            city: "Goa",
            start: "2026-10-09",
            end: "2026-10-11",
            budget: 5000,
        },
        { id: "a", name: "Aarav" },
    );
    s.members.push({ id: "b", name: "Riya" });
    for (let i = 0; i < 2; i++) {
        s = act(s, "propose", { id: `p${i}`, place: catalogue.places[i] });
        s = act(s, "schedule", {
            id: `s${i}`,
            proposalId: `p${i}`,
            date: s.trip.start,
            start: i ? "12:00" : "09:00",
            end: i ? "13:00" : "10:00",
            cost: 100,
            travel: i ? 30 : 0,
        });
    }
    return s;
}
test("reorder previews timings and travel, does not mutate, applies then undoes; changed itinerary blocks old undo", () => {
    let s = fresh(),
        old = C.clone(s.stops),
        p = C.agreement.outing.preview(s, s.trip.start, ["s1", "s0"], C);
    assert.deepEqual(s.stops, old);
    assert.equal(p.conflicts.length, 0);
    assert.equal(p.stops[0].start, "09:30");
    s = act(
        s,
        "reorderStops",
        { date: s.trip.start, ids: p.ids, sourceStops: JSON.stringify(s.stops) },
        "b",
    );
    assert.equal(C.orderedStops(s)[0].id, "s1");
    s = act(s, "undoReorder", {}, "b");
    assert.deepEqual(s.stops, old);
    s = act(s, "reorderStops", { date: s.trip.start, ids: p.ids });
    s = act(s, "editStop", { ...s.stops[0], note: "Changed later" });
    assert.throws(() => act(s, "undoReorder"), /changed after/);
});
test("reordering respects pinned / fixed times and cross-day overlap detection", () => {
    let s = fresh();
    s = act(s, "pinStop", { id: "s0", pinned: true });
    const p = C.agreement.outing.preview(s, s.trip.start, ["s1", "s0"], C);
    assert.ok(p.conflicts.some((x) => x.includes("fixed/pinned")));
    assert.throws(() => act(s, "reorderStops", { date: s.trip.start, ids: p.ids }), /fixed/);
    assert.throws(
        () => C.agreement.outing.preview(s, s.trip.start, ["s0", "s0"], C),
        /exactly once/,
    );
});
test("removing a visited stop clears its visit without carrying it onto a rescheduled stop", () => {
    let s = act(fresh(), "markVisited", { id: "s0", visited: true });
    const slot = C.clone(s.stops.find((p) => p.id === "s0"));
    s = act(s, "removeStop", { id: "s0" });
    assert.equal(s.visits.s0, undefined);
    s = act(s, "schedule", { ...slot, proposalId: "p0" });
    assert.equal(s.visits.s0, undefined);
    assert.equal(s.proposals.find((p) => p.id === "p0").status, "scheduled");
});
test("comments are attributed, timestamped, safe data and author-owned; visits do not affect attendance", () => {
    let s = fresh();
    s = act(
        s,
        "addComment",
        { proposalId: "p0", id: "c", text: "<script>text only</script>" },
        "b",
    );
    assert.equal(s.proposals[0].comments[0].by, "b");
    assert.ok(s.proposals[0].comments[0].createdAt);
    assert.throws(
        () => act(s, "editComment", { proposalId: "p0", id: "c", text: "wrong" }),
        /author/,
    );
    s = act(s, "editComment", { proposalId: "p0", id: "c", text: "Meet at the gate" }, "b");
    assert.ok(s.proposals[0].comments[0].updatedAt);
    s = act(s, "markVisited", { id: "s0", visited: true }, "b");
    assert.deepEqual(s.attendance, {});
    assert.equal(s.visits.s0.by, "b");
    s = act(s, "deleteComment", { proposalId: "p0", id: "c" }, "b");
    assert.equal(s.proposals[0].comments.length, 0);
});
test("Today uses the trip timezone, supports midnight, past and empty days, and remaining estimates", () => {
    let s = fresh();
    const today = C.agreement.outing.today(s, new Date("2026-10-08T21:00:00Z"));
    assert.equal(today.date, "2026-10-09");
    assert.equal(today.next.id, "s0");
    s = act(s, "markVisited", { id: "s0", visited: true });
    assert.equal(C.agreement.outing.today(s, new Date("2026-10-08T21:00:00Z")).spentKnown, 10000);
    assert.equal(
        C.agreement.outing.today(s, new Date("2026-10-10T15:00:00Z")).activities.length,
        0,
    );
    s = act(s, "editStop", {
        ...s.stops[1],
        start: "23:00",
        end: "01:00",
        endNextDay: true,
        travel: 0,
    });
    assert.equal(C.agreement.outing.today(s, new Date("2026-10-09T19:00:00Z")).next.id, "s1");
});
test("map keeps Google coordinates transient and off an unconfigured non-Google map", async () => {
    let s = fresh();
    s.stops[0].place = { ...s.stops[0].place, id: "google-x", provider: "google" };
    s = act(s, "setCoordinates", {
        id: "s1",
        coordinates: { latitude: 15.55, longitude: 73.75, source: "https://example.com/location" },
    });
    const maps = createMapService({ env: {} });
    const m = await maps.map(
        s,
        s.trip.start,
        {
            details: () => {
                throw new Error("Should not fetch Google");
            },
        },
        "g",
    );
    assert.equal(m.points.length, 1);
    assert.equal(m.points[0].id, "s1");
    assert.ok(m.missing.some((p) => p.reason.includes("not configured")));
    assert.throws(
        () =>
            act(s, "setCoordinates", {
                id: "s0",
                coordinates: { latitude: 15, longitude: 74, source: "https://example.com" },
            }),
        /Refresh Google/,
    );
});
test("configured route data is validated with source and credentials remain inside server adapter", async () => {
    const s = fresh();
    s.stops.forEach(
        (p, i) =>
            (p.place.coordinates = {
                latitude: 15 + i / 100,
                longitude: 73,
                source: "https://example.com",
            }),
    );
    let sent;
    const maps = createMapService({
        env: { ROUTES_FEED_URL: "https://routes.example/feed", ROUTES_FEED_TOKEN: "private" },
        fetchImpl: async (url, options) => {
            sent = options;
            return Response.json({
                durationSeconds: 600,
                distanceMeters: 3000,
                provider: "Test provider",
                sourceUrl: "https://routes.example/source",
            });
        },
    });
    const r = await maps.route(s, { fromId: "s0", toId: "s1" }, {});
    assert.equal(r.durationSeconds, 600);
    assert.equal(sent.headers.Authorization, "Bearer private");
    assert.ok(!JSON.stringify(r).includes("private"));
});
