"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict");
const C = require("../shared/planner-core"),
    region = require("../shared/chikkamagaluru"),
    catalogue = require("../shared/catalogue"),
    exporter = require("../public/js/itinerary-export");
const trip = {
    title: "Our hills trip",
    city: "Chikmagalur",
    start: "2027-01-16",
    end: "2027-01-19",
    budget: 8000,
};
const train = {
    id: "outbound",
    from: "Mumbai station TBD",
    to: "Kadur (DRU)",
    departureDate: "2027-01-15",
    arrivalDate: "2027-01-16",
    departureTime: "18:00",
    arrivalTime: "09:00",
    train: "",
    status: "tentative",
};
const create = () => C.createState(trip, { id: "owner", name: "Organizer" });
test("regional catalogue preserves stable source-backed identities without seeding a trip", () => {
    assert.equal(region.places.length, 60);
    assert.equal(region.places.filter((p) => p.evidenceStatus === "research_lead").length, 13);
    assert.equal(new Set(catalogue.places.map((p) => p.id)).size, catalogue.places.length);
    for (const p of region.places) {
        assert.ok(p.sourceIds.length);
        for (const id of p.sourceIds) assert.ok(region.sources[id]?.url.startsWith("https://"));
        assert.equal(p.coordinates, null);
        assert.equal(p.photo, null);
        assert.equal(p.accessStatus, "not_checked_for_travel_dates");
        assert.deepEqual(C.place({ ...p, planningNote: "invented open access" }), p);
    }
    const state = create();
    assert.equal(state.trip.city, "Chikkamagaluru");
    assert.deepEqual(state.journeys, []);
    assert.deepEqual(state.stops, []);
    assert.equal(state.members.length, 1);
});
test("overnight trains outside local dates persist, export, and invalidate agreement", () => {
    const before = create();
    before.confirmation = { needsReview: false };
    const state = C.apply(before, { type: "addJourney", payload: train }, "owner");
    assert.equal(state.journeys[0].by, "owner");
    assert.equal(state.confirmation.needsReview, true);
    assert.equal(state.materialVersion, before.materialVersion + 1);
    assert.equal(exporter.buildModel(state).journeys[0].departureDate, "2027-01-15");
    assert.equal(exporter.buildModel(state).days.length, 4);
    assert.deepEqual(before.journeys, []);
});
test("train times may stay unknown; chronology, overlaps and member permissions are enforced", () => {
    let state = C.apply(
        create(),
        { type: "addJourney", payload: { ...train, departureTime: "", arrivalTime: "" } },
        "owner",
    );
    assert.equal(state.journeys[0].departureTime, "");
    state.members.push({ id: "friend", name: "Friend" });
    assert.throws(() => C.apply(state, { type: "editJourney", payload: train }, "friend"), /Only/);
    state = C.apply(state, { type: "editJourney", payload: train }, "owner");
    assert.throws(
        () =>
            C.apply(state, { type: "addJourney", payload: { ...train, id: "duplicate" } }, "owner"),
        /overlap/,
    );
    assert.throws(
        () =>
            C.apply(
                state,
                { type: "editJourney", payload: { ...train, arrivalDate: "2027-01-15" } },
                "owner",
            ),
        /Arrival/,
    );
    state = C.apply(
        state,
        { type: "propose", payload: { id: "hill", place: region.places[0] } },
        "owner",
    );
    const schedule = {
        type: "schedule",
        payload: {
            id: "stop",
            proposalId: "hill",
            date: "2027-01-16",
            start: "08:30",
            end: "10:30",
        },
    };
    assert.throws(() => C.apply(state, schedule, "owner"), /train journey overlaps/i);
    state = C.apply(
        state,
        { type: "editJourney", payload: { ...train, status: "cancelled" } },
        "owner",
    );
    state = C.apply(state, schedule, "owner");
    assert.equal(state.stops.length, 1);
    assert.throws(
        () => C.apply(state, { type: "editJourney", payload: train }, "owner"),
        /overlaps/,
    );
});
