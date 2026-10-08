"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    C = require("../planner-core"),
    catalogue = require("../catalogue");
const trip = {
    title: "Friends in Goa",
    city: "Goa",
    start: "2026-10-09",
    end: "2026-10-11",
    budget: 5000,
};
const act = (s, type, payload = {}, id = "a") => C.apply(s, { type, payload }, id);
function fresh() {
    const s = C.createState(trip, { id: "a", name: "Aarav" });
    s.members.push({ id: "b", name: "Riya" });
    return s;
}
function prepared() {
    let s = act(fresh(), "addAvailability", {
        id: "fri",
        date: trip.start,
        start: "09:00",
        end: "21:00",
    });
    s = act(s, "chooseAvailability", { id: "fri", endDate: trip.end });
    s = act(s, "propose", { id: "beach", place: catalogue.places[0] });
    return act(s, "schedule", {
        id: "stop",
        proposalId: "beach",
        date: trip.start,
        start: "10:00",
        end: "11:00",
        cost: 0,
        travel: 0,
    });
}
test("legacy migrations preserve interested votes, unanswered members and organizer deterministically", () => {
    const old = fresh();
    old.proposals = [{ id: "p", place: catalogue.places[0], votes: ["b"], status: "pending" }];
    delete old.organizerId;
    delete old.availability;
    const s = C.migrate(old);
    assert.equal(s.organizerId, "a");
    assert.deepEqual(s.proposals[0].responses, { b: "interested" });
    assert.equal(s.attendance.a, undefined);
    assert.deepEqual(C.migrate(s), s);
    assert.equal(old.availability, undefined);
});
test("availability supports all options, explicit none, updates and no automatic confirmation", () => {
    let s = act(fresh(), "addAvailability", {
        id: "one",
        date: trip.start,
        start: "09:00",
        end: "21:00",
    });
    s = act(s, "addAvailability", { id: "two", date: trip.end, start: "10:00", end: "20:00" });
    s = act(s, "respondAvailability", { options: ["one", "two"] });
    s = act(s, "respondAvailability", { options: ["one"] }, "b");
    assert.equal(C.agreement.availabilitySummary(s)[0].common, true);
    assert.equal(s.availability.chosen, null);
    s = act(s, "respondAvailability", { options: [] }, "b");
    assert.equal(C.agreement.progress(s).missing.length, 0);
    assert.equal(C.agreement.availabilitySummary(s)[0].available.length, 1);
    assert.throws(() => act(s, "chooseAvailability", { id: "one" }, "b"), /organizer/);
    assert.throws(() => act(s, "respondAvailability", { options: ["fake"] }), /current poll/);
});
test("final date conflicts name affected scheduled activities before changing", () => {
    let s = prepared();
    s = act(s, "addAvailability", {
        id: "later",
        date: "2026-10-12",
        start: "10:00",
        end: "18:00",
    });
    assert.throws(
        () => act(s, "chooseAvailability", { id: "later" }),
        new RegExp(catalogue.places[0].name),
    );
    assert.equal(s.trip.start, trip.start);
});
test("confirmation snapshots stay agreed, material changes request reconfirmation; comments and votes don't", () => {
    let s = prepared();
    s = act(s, "respondAttendance", { response: "in" }, "b");
    s = act(s, "confirmPlan");
    const snapshot = C.clone(s.confirmation.snapshot);
    s = act(s, "respondSuggestion", { id: "beach", response: "pass" }, "b");
    assert.equal(s.confirmation.needsReview, false);
    s = act(s, "editStop", { ...s.stops[0], cost: 150 });
    assert.equal(s.confirmation.needsReview, true);
    assert.deepEqual(s.confirmation.snapshot, snapshot);
    assert.equal(C.agreement.progress(s).reconfirm[0].id, "b");
    s = act(s, "respondAttendance", { response: "in" }, "b");
    assert.equal(C.agreement.progress(s).inMembers[0].id, "b");
    assert.throws(() => act(s, "confirmPlan", {}, "b"), /organizer/);
});
test("one suggestion response per member replaces earlier response and leaves attendance independent", () => {
    let s = act(fresh(), "propose", { id: "p", place: catalogue.places[0] });
    s = act(s, "respondSuggestion", { id: "p", response: "maybe" });
    s = act(s, "respondSuggestion", { id: "p", response: "pass" });
    assert.deepEqual(s.proposals[0].votes, []);
    assert.deepEqual(s.proposals[0].responses, { a: "pass" });
    assert.deepEqual(s.attendance, {});
});
test("common availability intersects differing selected windows and requires every response", () => {
    let s = act(fresh(), "addAvailability", {
        id: "early",
        date: trip.start,
        start: "09:00",
        end: "12:00",
    });
    s = act(s, "addAvailability", { id: "late", date: trip.start, start: "10:00", end: "13:00" });
    s = act(s, "respondAvailability", { options: ["early"] });
    assert.deepEqual(C.agreement.commonWindows(s), []);
    s = act(s, "respondAvailability", { options: ["late"] }, "b");
    assert.deepEqual(C.agreement.commonWindows(s), [
        { date: trip.start, start: "10:00", end: "12:00" },
    ]);
    s = act(s, "respondAvailability", { options: [] }, "b");
    assert.deepEqual(C.agreement.commonWindows(s), []);
});

test("planning guidance follows dates, ideas, scheduling and attendance in order", () => {
    let s = fresh();
    assert.match(C.agreement.progress(s).next, /propose dates/);
    assert.equal(C.agreement.progress(s).nextView, "group");
    s = act(s, "respondAttendance", { response: "in" });
    s = act(s, "propose", { id: "p", place: catalogue.places[0] });
    s = act(s, "schedule", {
        id: "s",
        proposalId: "p",
        date: trip.start,
        start: "10:00",
        end: "11:00",
        cost: 0,
        travel: 0,
    });
    assert.equal(C.agreement.progress(s).stage, "Choosing a date");
    assert.match(C.agreement.progress(s).next, /propose dates/);
    assert.equal(C.agreement.progress(s).reconfirm.length, 0);
    assert.equal(C.agreement.progress(s).inMembers.length, 1);
    let planning = act(fresh(), "addAvailability", {
        id: "one",
        date: trip.start,
        start: "09:00",
        end: "21:00",
    });
    planning = act(planning, "chooseAvailability", { id: "one", endDate: trip.end });
    assert.equal(C.agreement.progress(planning).nextView, "discover");
    planning = act(planning, "propose", { id: "p", place: catalogue.places[0] });
    assert.equal(C.agreement.progress(planning).nextView, "ideas");
});

test("initial confirmation establishes attendance baseline; cosmetic names do not require reconfirmation", () => {
    let s = act(fresh(), "respondAttendance", { response: "in" }, "b");
    s = act(s, "addAvailability", {
        id: "one",
        date: trip.start,
        start: "09:00",
        end: "21:00",
    });
    s = act(s, "chooseAvailability", { id: "one", endDate: trip.end });
    s = act(s, "propose", { id: "p", place: catalogue.places[0] });
    s = act(s, "schedule", {
        id: "s",
        proposalId: "p",
        date: trip.start,
        start: "10:00",
        end: "11:00",
        cost: 0,
        travel: 0,
    });
    s = act(s, "confirmPlan");
    assert.equal(C.agreement.progress(s).reconfirm.length, 0);
    assert.equal(s.attendance.b.version, s.materialVersion);
    const version = s.materialVersion;
    s = act(s, "updateTrip", { ...s.trip, title: "A new trip title" });
    assert.equal(s.materialVersion, version);
    assert.equal(s.confirmation.needsReview, false);
    s = act(s, "editStop", { ...s.stops[0], cost: 100 });
    s = act(s, "confirmPlan");
    assert.equal(C.agreement.progress(s).reconfirm[0].id, "b");
    assert.equal(s.attendance.b.version, version, "organizer cannot reconfirm for a member");
});

test("trip edits preserve timezone and explain conflicting activity names", () => {
    let s = prepared();
    s = act(s, "updateTrip", { ...s.trip, timezone: "Asia/Singapore" });
    const details = { ...s.trip, title: "Edited title" };
    delete details.timezone;
    s = act(s, "updateTrip", details);
    assert.equal(s.trip.timezone, "Asia/Singapore");
    assert.throws(
        () => act(s, "updateTrip", { ...s.trip, start: "2026-10-10" }),
        new RegExp(catalogue.places[0].name),
    );
});

test("personal next actions distinguish organizer and member responsibilities", () => {
    let s = C.createState(
        {
            title: "Personal guidance",
            city: "Goa",
            start: "2026-10-09",
            end: "2026-10-10",
            budget: 5000,
        },
        { id: "a", name: "Host" },
    );
    s.members.push({ id: "b", name: "Friend" });
    assert.equal(C.agreement.progress(s, "b").nextView, "fit");
    assert.equal(C.agreement.progress(s, "a").nextLabel, "Propose dates");
    s = C.apply(
        s,
        {
            type: "addAvailability",
            payload: { id: "d", date: "2026-10-09", start: "09:00", end: "21:00" },
        },
        "a",
    );
    assert.equal(C.agreement.progress(s, "b").nextLabel, "Answer my availability");
    s = C.apply(
        s,
        { type: "chooseAvailability", payload: { id: "d", endDate: "2026-10-10" } },
        "a",
    );
    assert.equal(C.agreement.progress(s, "b").nextView, "fit");
    assert.equal(C.agreement.progress(s, "b").stage, "Shortlisting");
});
