"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    C = require("../shared/planner-core.js"),
    catalogue = require("../shared/catalogue.js"),
    exporter = require("../public/js/itinerary-export.js");
const act = (s, type, payload = {}, member = "a") => C.apply(s, { type, payload }, member);
const Fit = C.agreement.fit,
    Time = C.agreement.time;
function fresh() {
    const s = C.createState(
        {
            title: "Goa after dark",
            city: "Goa",
            start: "2026-10-09",
            end: "2026-10-10",
            budget: 5000,
            timezone: "Asia/Kolkata",
        },
        { id: "a", name: "Aarav" },
    );
    s.members.push({ id: "b", name: "Riya" });
    return s;
}
function night() {
    let s = act(fresh(), "addAvailability", {
        id: "night",
        date: "2026-10-09",
        start: "22:00",
        end: "02:00",
        endNextDay: true,
    });
    for (const m of s.members) {
        s = act(s, "respondAvailability", { options: ["night"] }, m.id);
        s = act(
            s,
            "savePreferences",
            {
                interests: ["Nightlife"],
                pace: "balanced",
                budgetPaise: 500000,
                mustHave: "",
                needs: [],
            },
            m.id,
        );
    }
    return s;
}
function event(
    s,
    {
        id = "event",
        date = s.trip.start,
        start = "23:00",
        duration = 120,
        cost = 10000,
        travel = 30,
    } = {},
) {
    s = act(s, "propose", {
        id,
        place: {
            ...catalogue.places[0],
            id,
            name: "Published event fixture",
            category: "Event",
            eventDate: date,
            eventEndDate: date,
            eventTime: start,
            duration,
        },
    });
    return act(s, "estimateSuggestion", { id, costPaise: cost, travel });
}
test("overnight polls intersect next-day and adjacent windows; explicit none and unanswered stay distinct", () => {
    let s = night();
    s = act(s, "addAvailability", {
        id: "after",
        date: "2026-10-10",
        start: "00:00",
        end: "03:00",
    });
    assert.deepEqual(C.agreement.commonWindows(s), []);
    s = act(s, "respondAvailability", { options: ["night"] });
    s = act(s, "respondAvailability", { options: ["after"] }, "b");
    assert.deepEqual(C.agreement.commonWindows(s), [
        { date: "2026-10-10", start: "00:00", end: "02:00" },
    ]);
    s = act(s, "respondAvailability", { options: ["night", "after"] }, "b");
    assert.deepEqual(C.agreement.commonWindows(s), [
        { date: "2026-10-09", start: "22:00", end: "02:00", endNextDay: true },
    ]);
    s = act(s, "respondAvailability", { options: [] }, "b");
    assert.equal(C.agreement.progress(s).missing.length, 0);
    assert.deepEqual(C.agreement.commonWindows(s), []);
});
test("overnight window validation, duplicate detection and explicit final date include the ending day", () => {
    const s = night();
    assert.throws(
        () =>
            act(s, "addAvailability", {
                id: "bad",
                date: s.trip.start,
                start: "22:00",
                end: "02:00",
            }),
        /Ends next day/,
    );
    assert.throws(
        () =>
            act(s, "addAvailability", {
                id: "long",
                date: s.trip.start,
                start: "09:00",
                end: "10:00",
                endNextDay: true,
            }),
        /24 hours/,
    );
    assert.throws(
        () =>
            act(s, "addAvailability", {
                id: "dup",
                date: s.trip.start,
                start: "22:00",
                end: "02:00",
                endNextDay: true,
            }),
        /already exists/,
    );
    assert.throws(
        () => act(s, "chooseAvailability", { id: "night", endDate: s.trip.start }),
        /overnight availability/,
    );
    const chosen = act(s, "chooseAvailability", { id: "night" });
    assert.equal(chosen.trip.end, "2026-10-10");
    assert.equal(chosen.confirmation, null);
    assert.throws(
        () => act(chosen, "updateTrip", { ...chosen.trip, end: chosen.trip.start }),
        /chosen availability window ends/,
    );
    assert.match(Time.label(chosen.availability.chosen), /\+1 day, 2026-10-10/);
});
test("fixed late events draft across midnight with travel and agree with Today and PDF in the trip timezone", () => {
    let s = event(night());
    const original = C.clone(s.stops);
    s = act(s, "generateDrafts", { places: [] });
    assert.deepEqual(s.stops, original);
    const draft = s.drafts[0],
        stop = draft.stops[0];
    assert.equal(stop.start, "23:00");
    assert.equal(stop.end, "01:00");
    assert.equal(stop.endNextDay, true);
    assert.equal(stop.travel, 30);
    assert.deepEqual(draft.assessment.hard, []);
    s = act(s, "applyDraft", { id: draft.id, acknowledge: true });
    const today = C.agreement.outing.today(s, new Date("2026-10-09T19:00:00Z"));
    assert.equal(today.date, "2026-10-10");
    assert.equal(today.next.id, stop.id);
    const pdf = exporter.buildModel(s);
    assert.equal(pdf.trip.timezone, "Asia/Kolkata");
    assert.equal(pdf.days[0].stops[0].endNextDay, true);
    assert.equal(pdf.days[0].stops[0].date, stop.date);
    assert.throws(
        () => C.slot(s, { date: "2026-10-10", start: "01:15", end: "02:00", travel: 30, cost: 0 }),
        /overlaps/,
    );
});
test("flexible late-night suggestions can span midnight without a fabricated fixed start", () => {
    let s = night();
    s = act(s, "propose", {
        id: "club",
        place: { ...catalogue.places[0], id: "club", category: "Nightlife", duration: 180 },
    });
    s = act(s, "estimateSuggestion", { id: "club", costPaise: 10000, travel: 30 });
    s = act(s, "generateDrafts", { places: [] });
    const stop = s.drafts[0].stops[0];
    assert.equal(stop.start, "22:30");
    assert.equal(stop.end, "01:30");
    assert.equal(stop.endNextDay, true);
    assert.equal(stop.place.eventTime, undefined);
    assert.deepEqual(s.drafts[0].assessment.hard, []);
});
test("adjacent midnight windows cover an activity and travel that begins on the previous day", () => {
    let s = night();
    s = act(s, "addAvailability", {
        id: "midnight",
        date: "2026-10-09",
        start: "22:00",
        end: "00:00",
        endNextDay: true,
    });
    s = act(s, "addAvailability", {
        id: "morning",
        date: "2026-10-10",
        start: "00:00",
        end: "02:00",
    });
    for (const m of s.members)
        s = act(s, "respondAvailability", { options: ["midnight", "morning"] }, m.id);
    s = event(s, { date: "2026-10-10", start: "00:15", duration: 60, travel: 30 });
    s = act(s, "generateDrafts", { places: [] });
    assert.equal(s.drafts[0].stops[0].date, "2026-10-10");
    assert.equal(s.drafts[0].stops[0].start, "00:15");
    assert.deepEqual(s.drafts[0].assessment.hard, []);
});
test("pinned previous-night stops remain exact and block fixed events whose travel overlaps them", () => {
    let s = event(night(), { id: "first", start: "23:00", duration: 120, travel: 0 });
    s = act(s, "schedule", {
        id: "pinned",
        proposalId: "first",
        date: s.trip.start,
        start: "23:00",
        end: "01:00",
        endNextDay: true,
        travel: 0,
        cost: 100,
    });
    s = act(s, "pinStop", { id: "pinned", pinned: true });
    const original = C.clone(s.stops[0]);
    s = event(s, { id: "second", date: "2026-10-10", start: "01:15", duration: 30, travel: 30 });
    s = act(s, "generateDrafts", { places: [] });
    for (const draft of s.drafts) {
        assert.deepEqual(
            draft.stops.find((x) => x.id === "pinned"),
            original,
        );
        assert.equal(
            draft.stops.some((x) => x.place.id === "second"),
            false,
        );
    }
});
test("missing overnight poll coverage is unknown; a declined covered window is a known conflict", () => {
    let s = night();
    const stop = {
        date: "2026-10-09",
        start: "23:00",
        end: "03:00",
        endNextDay: true,
        travel: 0,
        travelKnown: true,
        cost: 0,
        costKnown: true,
        place: catalogue.places[0],
    };
    assert.ok(Fit.assess(s, [stop]).missing.some((x) => x.includes("no polled availability")));
    assert.deepEqual(Fit.assess(s, [stop]).hard, []);
    s = act(s, "respondAvailability", { options: [] }, "b");
    assert.ok(Fit.assess(s, [stop]).hard.some((x) => x.includes("Riya") && x.includes("outside")));
});
test("required supplied categories distinguish known unmet needs from missing labels and never infer suitability", () => {
    let s = night();
    s = act(
        s,
        "savePreferences",
        { interests: [], pace: "balanced", budgetPaise: null, mustHave: "vegan", needs: ["Food"] },
        "b",
    );
    assert.throws(
        () =>
            act(s, "savePreferences", {
                interests: [],
                pace: "balanced",
                budgetPaise: null,
                needs: ["wheelchair accessible"],
            }),
        /supplied list/,
    );
    const stop = {
        date: s.trip.start,
        start: "22:00",
        end: "23:00",
        travel: 0,
        travelKnown: true,
        cost: 0,
        costKnown: true,
        place: { ...catalogue.places[0], name: "Vegan label fixture", category: "Beach" },
    };
    let report = Fit.assess(s, [stop]);
    assert.ok(report.hard.some((x) => x.includes("Riya: required Food")));
    assert.ok(report.missing.some((x) => x.includes("matches text only")));
    report = Fit.assess(s, [
        {
            ...stop,
            place: {
                ...stop.place,
                category: undefined,
                provider: "google",
                name: "Saved Google Maps place",
            },
        },
    ]);
    assert.ok(report.missing.some((x) => x.includes("category missing")));
    assert.ok(report.missing.some((x) => x.includes("labels missing")));
    assert.equal(
        report.hard.some((x) => x.includes("must-have") || x.includes("required Food")),
        false,
    );
    report = Fit.assess(s, [{ ...stop, place: { ...stop.place, category: "Food" } }]);
    assert.equal(
        report.hard.some((x) => x.includes("required Food")),
        false,
    );
});
test("empty bounded searches do not claim infeasibility, and votes never replace an itinerary", () => {
    let s = event(night(), { cost: 600000 });
    s = act(s, "generateDrafts", { places: [] });
    assert.equal(s.drafts[0].stops.length, 0);
    assert.match(s.drafts[0].searchNote, /does not prove/);
    s = act(s, "voteDraft", { id: s.drafts[0].id }, "b");
    assert.deepEqual(s.stops, []);
    assert.throws(
        () => act(s, "applyDraft", { id: s.drafts[0].id, acknowledge: true }),
        /draft has no activities/,
    );
});
test("old polls and preferences migrate idempotently, and multi-day adjacent availability retains full coverage", () => {
    let s = night();
    delete s.preferences.a.needs;
    s.availability.options.push({ id: "day", date: "2026-10-10", start: "02:00", end: "23:00" });
    delete s.availability.options[1].endNextDay;
    const migrated = C.migrate(s);
    assert.equal(s.availability.options[1].endNextDay, undefined);
    assert.equal(migrated.availability.options[1].endNextDay, false);
    assert.deepEqual(migrated.preferences.a.needs, []);
    assert.deepEqual(C.migrate(migrated), migrated);
    for (const m of migrated.members) migrated.availability.responses[m.id] = ["night", "day"];
    const windows = C.agreement.commonWindows(migrated);
    assert.equal(windows.length, 2);
    assert.deepEqual(Time.merge(windows.map((o) => Time.interval(o))), [
        [Time.day(s.trip.start) + 1320, Time.day(s.trip.end) + 1380],
    ]);
});
