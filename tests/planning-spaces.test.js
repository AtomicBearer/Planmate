"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    Core = require("../shared/planner-core"),
    Spaces = require("../public/js/planning-spaces");
const saved = (title = "Our next trip") => ({
    state: Core.createState(
        { title, city: "Goa", start: "2026-10-10", end: "2026-10-11", budget: 3000 },
        { id: "me", name: "Mira" },
    ),
    memberId: "me",
});
test("fresh or corrupt storage starts empty without creating a sample trip", () => {
    for (const spaces of [null, {}, [], { broken: {} }]) {
        assert.equal(Spaces.select(spaces, "missing", "missing"), "");
        assert.deepEqual(Spaces.entries(spaces), []);
    }
});
test("saved personal trips preserve explicit choice, last selection and existing data", () => {
    const spaces = { first: saved(), second: saved("Mumbai weekend") },
        original = JSON.stringify(spaces);
    assert.equal(Spaces.select(spaces, "second", "first"), "second");
    assert.equal(Spaces.select(spaces, "missing", "second"), "second");
    assert.equal(Spaces.select(spaces, "missing", "missing"), "first");
    assert.equal(JSON.stringify(spaces), original);
});
test("legacy sample entries remain untouched while real trips are selected", () => {
    const spaces = { preview: { ...saved(), preview: true }, personal: saved("My saved trip") },
        original = JSON.stringify(spaces);
    assert.equal(Spaces.select(spaces, "preview", "preview"), "personal");
    assert.equal(Spaces.select({ preview: spaces.preview }, "preview", "preview"), "");
    assert.deepEqual(
        Spaces.entries(spaces).map(([id]) => id),
        ["personal"],
    );
    assert.deepEqual(
        Spaces.entries(spaces, { includeLegacy: true }).map(([id]) => id),
        ["preview", "personal"],
    );
    assert.equal(JSON.stringify(spaces), original);
});
test("damaged records and removed local membership cannot be opened as active trips", () => {
    const entry = saved();
    entry.state.members[0].removed = true;
    assert.equal(Spaces.valid(entry), false);
    assert.equal(Spaces.valid({ ...saved(), memberId: "someone-else" }), false);
    assert.equal(Spaces.valid(saved()), true);
});
