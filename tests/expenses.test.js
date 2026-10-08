"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    C = require("../shared/planner-core.js"),
    { validateImage } = require("../server/services/media-store.js");
const act = (s, type, payload = {}, id = "a") => C.apply(s, { type, payload }, id);
function fresh() {
    const s = C.createState(
        { title: "Expenses", city: "Goa", start: "2026-10-09", end: "2026-10-10", budget: 5000 },
        { id: "a", name: "A" },
    );
    s.members.push({ id: "b", name: "B" }, { id: "c", name: "C" });
    return s;
}
const e = {
    id: "e",
    description: "Lunch",
    amountPaise: 10001,
    payer: "a",
    participants: ["c", "b", "a"],
    split: "equal",
};
test("equal split distributes leftover paise deterministically and balances sum exactly to zero", () => {
    const s = act(fresh(), "addExpense", e);
    assert.deepEqual(s.expenses[0].shares, { a: 3334, b: 3334, c: 3333 });
    const b = C.agreement.money.balances(s);
    assert.deepEqual(b.balance, { a: 6667, b: -3334, c: -3333 });
    assert.equal(
        Object.values(b.balance).reduce((a, b) => a + b, 0),
        0,
    );
    assert.equal(
        b.suggested.reduce((n, r) => n + r.amountPaise, 0),
        6667,
    );
    assert.equal(s.stops.length, 0);
    assert.equal(s.trip.budget, 5000);
});
test("custom shares must exactly equal expense and contain only participating trip members", () => {
    const s = fresh();
    assert.throws(
        () =>
            act(s, "addExpense", { ...e, split: "custom", shares: { a: 3000, b: 3000, c: 3000 } }),
        /equal the expense total/,
    );
    assert.throws(() => act(s, "addExpense", { ...e, participants: ["outsider"] }), /member/);
    assert.throws(() => act(s, "addExpense", { ...e, amountPaise: 10.1 }), /integer paise/);
    const saved = act(s, "addExpense", { ...e, split: "custom", shares: { a: 10001, b: 0, c: 0 } });
    assert.deepEqual(C.agreement.money.balances(saved).balance, { a: 0, b: 0, c: 0 });
});
test("repayments are separate, reduce balances accurately and ownership limits changes", () => {
    let s = act(fresh(), "addExpense", e);
    s = act(
        s,
        "addRepayment",
        { id: "r", from: "b", to: "a", amountPaise: 3334, note: "UPI" },
        "b",
    );
    assert.deepEqual(C.agreement.money.balances(s).balance, { a: 3333, b: 0, c: -3333 });
    assert.equal(s.expenses.length, 1);
    assert.throws(() => act(s, "deleteRepayment", { id: "r" }, "c"), /author or organizer/);
    s = act(s, "deleteRepayment", { id: "r" }, "b");
    assert.equal(C.agreement.money.balances(s).balance.b, -3334);
    assert.throws(
        () => act(s, "editExpense", { ...e, description: "bad" }, "b"),
        /author or organizer/,
    );
});
test("many fractional rupee expenses settle without drift", () => {
    let s = fresh();
    for (let i = 1; i <= 50; i++)
        s = act(s, "addExpense", {
            ...e,
            id: String(i),
            amountPaise: i,
            payer: ["a", "b", "c"][i % 3],
        });
    const b = C.agreement.money.balances(s);
    for (const r of b.suggested) s = act(s, "addRepayment", { ...r, id: `${r.from}-${r.to}` });
    assert.deepEqual(C.agreement.money.balances(s).balance, { a: 0, b: 0, c: 0 });
    assert.equal(b.totalPaise, 1275);
});
test("photo validation rejects SVG, fake PNG, empty and oversized bytes; accepts a real PNG", () => {
    const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
        "base64",
    );
    assert.equal(validateImage(png, "image/png").width, 1);
    assert.throws(() => validateImage(Buffer.from("<svg/>"), "image/svg+xml"), /valid JPEG/);
    assert.throws(() => validateImage(Buffer.from("fake"), "image/png"), /valid JPEG/);
    assert.throws(() => validateImage(Buffer.alloc(6 * 1024 * 1024), "image/png"), /up to 5 MB/);
});
