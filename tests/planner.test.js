"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../planner-core");
const catalogue = require("../catalogue");
const trip = {
    title: "Goa together",
    city: "Goa",
    start: "2026-10-09",
    end: "2026-10-11",
    budget: 5000,
};
const place = catalogue.places[0];
function fresh() {
    const state = C.createState(trip, { id: "a", name: "Aarav" });
    state.members.push({ id: "b", name: "Riya" });
    return state;
}
function idea(state, id = "idea", p = place) {
    return C.apply(state, { type: "propose", payload: { id, place: p } }, "a");
}
function schedule(state, changes = {}) {
    return C.apply(
        state,
        {
            type: "schedule",
            payload: {
                id: "stop",
                proposalId: "idea",
                date: trip.start,
                start: "10:00",
                end: "11:00",
                cost: 500,
                travel: 30,
                ...changes,
            },
        },
        "a",
    );
}
test("catalogue has unique valid IDs and working category coverage", () => {
    assert.equal(new Set(catalogue.places.map((p) => p.id)).size, catalogue.places.length);
    for (const p of catalogue.places) assert.deepEqual(C.place(p), p);
    assert.ok(catalogue.cities.length >= 30);
    for (const category of ["Beach", "Food", "Nightlife", "Sights", "Outdoors"])
        assert.ok(catalogue.places.some((p) => p.category === category));
});
test("each member can toggle one vote; original state stays unchanged", () => {
    const state = idea(fresh());
    const voted = C.apply(state, { type: "vote", payload: { id: "idea" } }, "b");
    assert.deepEqual(voted.proposals[0].votes, ["a", "b"]);
    assert.deepEqual(state.proposals[0].votes, ["a"]);
    assert.deepEqual(
        C.apply(voted, { type: "vote", payload: { id: "idea" } }, "b").proposals[0].votes,
        ["a"],
    );
});
test("profile name changes affect only the acting member and keep votes attributed", () => {
    const state = idea(fresh());
    const renamed = C.apply(
        state,
        { type: "updateMember", payload: { name: "Riya Patel", memberId: "a" } },
        "b",
    );
    assert.equal(renamed.members.find((m) => m.id === "a").name, "Aarav");
    assert.equal(renamed.members.find((m) => m.id === "b").name, "Riya Patel");
    assert.deepEqual(renamed.proposals[0].votes, ["a"]);
    assert.throws(
        () => C.apply(state, { type: "updateMember", payload: { name: "  " } }, "a"),
        /Display name/,
    );
});
test("cannot propose the same pending place twice", () =>
    assert.throws(() => idea(idea(fresh()), "second"), /already on the ideas board/));
test("scheduling closes a proposal and cannot be repeated", () => {
    const state = schedule(idea(fresh()));
    assert.equal(state.proposals[0].status, "scheduled");
    assert.throws(() => schedule(state, { id: "duplicate" }), /already been scheduled/);
});
test("travel buffers participate in overlap checks", () => {
    let state = schedule(idea(fresh()));
    state = idea(state, "second", catalogue.places[1]);
    assert.throws(
        () =>
            schedule(state, {
                id: "second-stop",
                proposalId: "second",
                start: "11:15",
                end: "12:00",
                travel: 30,
            }),
        /overlaps/,
    );
    assert.equal(
        schedule(state, {
            id: "second-stop",
            proposalId: "second",
            start: "11:30",
            end: "12:00",
            travel: 30,
        }).stops.length,
        2,
    );
});
test("overnight stops conflict with the next day and travel can cross midnight", () => {
    let state = schedule(idea(fresh()), {
        start: "23:00",
        end: "01:00",
        endNextDay: true,
        travel: 0,
    });
    state = idea(state, "second", catalogue.places[1]);
    assert.throws(
        () =>
            schedule(state, {
                id: "second-stop",
                proposalId: "second",
                date: "2026-10-10",
                start: "01:15",
                end: "02:00",
                travel: 30,
            }),
        /overlaps/,
    );
    assert.equal(
        schedule(state, {
            id: "second-stop",
            proposalId: "second",
            date: "2026-10-10",
            start: "01:30",
            end: "02:00",
            travel: 30,
        }).stops.length,
        2,
    );
});
test("overnight duration must be valid and end time must follow start", () => {
    const state = idea(fresh());
    assert.throws(() => schedule(state, { start: "22:00", end: "01:00" }), /End time/);
    assert.throws(
        () => schedule(state, { start: "10:00", end: "11:00", endNextDay: true }),
        /End time/,
    );
});
test("editing excludes the current stop, removing returns the idea to voting", () => {
    let state = schedule(idea(fresh()));
    state = C.apply(state, { type: "editStop", payload: { ...state.stops[0], cost: 600 } }, "b");
    assert.equal(state.stops[0].cost, 600);
    state = C.apply(state, { type: "removeStop", payload: { id: "stop" } }, "b");
    assert.equal(state.stops.length, 0);
    assert.equal(state.proposals[0].status, "pending");
    assert.deepEqual(state.proposals[0].votes, ["a"]);
});
test("rejects invalid dates, excessive trip length and changed dates excluding stops", () => {
    assert.throws(() => C.date("2026-02-30"), /valid date/);
    assert.throws(() => C.dates("2026-10-10", "2026-10-09"), /end date/);
    assert.throws(() => C.dates("2026-10-01", "2026-11-01"), /31 days/);
    assert.throws(
        () =>
            C.apply(
                schedule(idea(fresh())),
                { type: "updateTrip", payload: { ...trip, start: "2026-10-10" } },
                "a",
            ),
        /Move or remove/,
    );
});
test("rejects nonfinite money, unsafe links, unknown members and idea deletion by another member", () => {
    assert.throws(() => schedule(idea(fresh()), { cost: NaN }), /Estimated cost/);
    assert.throws(() => C.place({ ...place, source: "javascript:alert(1)" }), /https/);
    assert.throws(
        () => C.apply(idea(fresh()), { type: "vote", payload: { id: "idea" } }, "outsider"),
        /Join the group/,
    );
    assert.throws(
        () => C.apply(idea(fresh()), { type: "removeIdea", payload: { id: "idea" } }, "b"),
        /Only the person/,
    );
});
test("a custom event has a valid preferred day and retained venue link", () => {
    const event = {
        ...place,
        id: "event",
        category: "Event",
        name: "Friends’ gig",
        source: "https://example.com/event",
        custom: true,
    };
    const state = C.apply(
        fresh(),
        { type: "propose", payload: { id: "idea", place: event, preferredDate: trip.start } },
        "b",
    );
    assert.equal(state.proposals[0].place.source, event.source);
    assert.throws(
        () =>
            C.apply(
                fresh(),
                {
                    type: "propose",
                    payload: { id: "idea", place: event, preferredDate: "2026-10-12" },
                },
                "b",
            ),
        /within the trip/,
    );
});
