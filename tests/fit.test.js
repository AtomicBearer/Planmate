"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    C = require("../planner-core"),
    catalogue = require("../catalogue");
const act = (s, type, payload = {}, id = "a") => C.apply(s, { type, payload }, id);
function fresh() {
    let s = C.createState(
        { title: "Group Goa", city: "Goa", start: "2026-10-09", end: "2026-10-09", budget: 5000 },
        { id: "a", name: "Aarav" },
    );
    s.members.push({ id: "b", name: "Riya" });
    s = act(s, "addAvailability", { id: "fri", date: s.trip.start, start: "09:00", end: "23:00" });
    for (const id of ["a", "b"]) {
        s = act(s, "respondAvailability", { options: ["fri"] }, id);
        s = act(
            s,
            "savePreferences",
            { interests: ["Beach"], pace: "balanced", budgetPaise: 500000, mustHave: "" },
            id,
        );
    }
    return s;
}
function proposed() {
    let s = fresh();
    for (const [i, p] of catalogue.places
        .filter((p) => p.city === "Goa")
        .slice(0, 7)
        .entries()) {
        s = act(s, "propose", { id: `p${i}`, place: p });
        s = act(s, "estimateSuggestion", { id: `p${i}`, costPaise: i * 10000, travel: 20 });
    }
    return s;
}
test("ranking explains interests, passes, individual budgets and missing cost instead of free", () => {
    let s = proposed();
    s = act(
        s,
        "savePreferences",
        { interests: ["Beach"], pace: "relaxed", budgetPaise: 1000, mustHave: "" },
        "b",
    );
    s = act(s, "respondSuggestion", { id: "p1", response: "pass" }, "b");
    const rows = C.agreement.fit.rank(s);
    assert.ok(
        rows.find((r) => r.proposal.id === "p0").reasons.some((x) => x.includes("Matches 2")),
    );
    assert.ok(rows.find((r) => r.proposal.id === "p1").unmet.some((x) => x.includes("Riya")));
    s = act(s, "estimateSuggestion", { id: "p0", costPaise: null, travel: null });
    const unknown = C.agreement.fit.rank(s).find((r) => r.proposal.id === "p0");
    assert.equal(unknown.costPaise, null);
    assert.ok(unknown.missing.some((x) => x.includes("affordability unverified")));
});
test("member preferences are shared for their own identity, never another member", () => {
    const s = act(
        fresh(),
        "savePreferences",
        {
            memberId: "a",
            interests: ["Food"],
            pace: "relaxed",
            budgetPaise: null,
            mustHave: "Café",
        },
        "b",
    );
    assert.deepEqual(s.preferences.a.interests, ["Beach"]);
    assert.deepEqual(s.preferences.b.interests, ["Food"]);
    assert.throws(
        () => act(s, "savePreferences", { interests: [], pace: "packed", budgetPaise: 12.3 }),
        /integer paise/,
    );
});
test("draft generation changes no itinerary, retains pinned stops and fixed event times; ballots don't auto apply", () => {
    let s = proposed();
    s = act(s, "schedule", {
        id: "pinned",
        proposalId: "p0",
        date: s.trip.start,
        start: "10:00",
        end: "11:00",
        cost: 0,
        travel: 0,
    });
    s = act(s, "pinStop", { id: "pinned", pinned: true });
    const before = C.clone(s.stops);
    s = act(s, "generateDrafts", { places: [] });
    assert.ok(s.drafts.length <= 3);
    assert.deepEqual(s.stops, before);
    for (const d of s.drafts)
        assert.deepEqual(
            d.stops.find((x) => x.id === "pinned"),
            before[0],
        );
    s = act(s, "voteDraft", { id: s.drafts[0].id }, "b");
    assert.deepEqual(s.stops, before);
    assert.throws(
        () => act(s, "applyDraft", { id: s.drafts[0].id, acknowledge: true }, "b"),
        /organizer/,
    );
    s = act(s, "applyDraft", { id: s.drafts[0].id, acknowledge: true });
    assert.ok(s.stops.some((p) => p.id === "pinned"));
});
test("draft conflicts name unmet must-have needs, and stale inputs reject apply", () => {
    let s = proposed();
    s = act(
        s,
        "savePreferences",
        {
            interests: ["Beach"],
            pace: "balanced",
            budgetPaise: 500000,
            mustHave: "Impossible place",
        },
        "b",
    );
    s = act(s, "generateDrafts", { places: [] });
    assert.ok(
        s.drafts.every((d) =>
            d.assessment.hard.some((x) => x.includes("Riya") && x.includes("must-have")),
        ),
    );
    assert.throws(
        () => act(s, "applyDraft", { id: s.drafts[0].id, acknowledge: true }),
        /This draft has unresolved constraints/,
    );
    s = act(
        s,
        "savePreferences",
        { interests: ["Beach"], pace: "balanced", budgetPaise: 500000, mustHave: "" },
        "b",
    );
    s = act(s, "generateDrafts", { places: [] });
    s = act(s, "respondSuggestion", { id: "p0", response: "maybe" }, "b");
    assert.throws(
        () => act(s, "applyDraft", { id: s.drafts[0].id, acknowledge: true }),
        /Regenerate/,
    );
});
test("fixed-time discovered events are drafted at published times and real dates", () => {
    let s = fresh();
    s = act(s, "propose", {
        id: "event",
        place: {
            ...catalogue.places[0],
            id: "actual",
            name: "Organiser concert",
            category: "Event",
            eventDate: s.trip.start,
            eventEndDate: s.trip.end,
            eventTime: "19:00",
            duration: 90,
        },
    });
    s = act(s, "estimateSuggestion", { id: "event", costPaise: 10000, travel: 0 });
    s = act(s, "generateDrafts", { places: [] });
    assert.equal(s.drafts[0].stops[0].start, "19:00");
    assert.equal(s.drafts[0].stops[0].date, s.trip.start);
    assert.equal(
        s.drafts.length,
        1,
        "one fixed event yields one meaningful draft, not three identical plans",
    );
});
test("alternatives reuse supplied itinerary estimates when suggestions have no separate estimate", () => {
    let s = fresh();
    s = act(s, "propose", { id: "p", place: catalogue.places[0] });
    s = act(s, "schedule", {
        id: "s",
        proposalId: "p",
        date: s.trip.start,
        start: "10:00",
        end: "11:00",
        cost: 123.45,
        travel: 25,
    });
    s = act(s, "generateDrafts", { places: [] });
    assert.equal(s.drafts[0].stops[0].cost, 123.45);
    assert.equal(s.drafts[0].stops[0].costKnown, true);
    assert.equal(s.drafts[0].stops[0].travel, 25);
});

test("drafts find a later shared window and preserve supplied travel within it", () => {
    let s = fresh();
    s = act(s, "addAvailability", {
        id: "early",
        date: s.trip.start,
        start: "09:00",
        end: "12:00",
    });
    s = act(s, "addAvailability", {
        id: "late",
        date: s.trip.start,
        start: "10:00",
        end: "13:00",
    });
    s = act(s, "respondAvailability", { options: ["early"] });
    s = act(s, "respondAvailability", { options: ["late"] }, "b");
    s = act(s, "propose", { id: "p", place: { ...catalogue.places[0], duration: 60 } });
    s = act(s, "estimateSuggestion", { id: "p", costPaise: 1000, travel: 20 });
    s = act(s, "generateDrafts", { places: [] });
    assert.ok(s.drafts.length > 0);
    for (const draft of s.drafts) {
        assert.equal(draft.stops.length, 1);
        assert.equal(draft.stops[0].start, "10:20");
        assert.equal(draft.stops[0].end, "11:20");
        assert.deepEqual(draft.assessment.hard, []);
    }
});

test("adjacent selected windows agree with common availability and fit assessment", () => {
    let s = fresh();
    for (const [id, start, end] of [
        ["early", "09:00", "10:00"],
        ["late", "10:00", "12:00"],
    ])
        s = act(s, "addAvailability", { id, date: s.trip.start, start, end });
    for (const id of ["a", "b"])
        s = act(s, "respondAvailability", { options: ["early", "late"] }, id);
    s = act(s, "propose", { id: "p", place: { ...catalogue.places[0], duration: 120 } });
    s = act(s, "schedule", {
        id: "stop",
        proposalId: "p",
        date: s.trip.start,
        start: "09:30",
        end: "11:30",
        cost: 0,
        travel: 0,
    });
    assert.deepEqual(C.agreement.commonWindows(s), [
        { date: s.trip.start, start: "09:00", end: "12:00" },
    ]);
    assert.deepEqual(C.agreement.fit.assess(s, s.stops).hard, []);
});

test("legacy travel buffers survive migration and remain available to draft generation", () => {
    let s = fresh();
    s = act(s, "propose", { id: "p", place: catalogue.places[0] });
    s = act(s, "schedule", {
        id: "stop",
        proposalId: "p",
        date: s.trip.start,
        start: "10:00",
        end: "11:00",
        cost: 100,
        travel: 25,
    });
    delete s.stops[0].travelKnown;
    s = C.migrate(s);
    assert.equal(s.stops[0].travelKnown, true);
    s = act(s, "generateDrafts", { places: [] });
    assert.equal(s.drafts[0].stops[0].travel, 25);
    assert.equal(s.drafts[0].stops[0].travelKnown, true);
    assert.ok(!s.drafts[0].assessment.missing.some((m) => m.includes("travel buffers")));
});
