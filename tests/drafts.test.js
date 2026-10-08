"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    D = require("../public/js/form-drafts.js");
const context = { owner: "guest:browser", space: "trip-a", member: "a" };
function memory() {
    const data = new Map();
    return { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, v) };
}
test("private drafts separate trips, members and profile identities and retain multiple forms", () => {
    const storage = memory(),
        store = D.createStore(storage, () => 100);
    store.save(
        context,
        { source: "plan", kind: "preferences" },
        { mustHave: ["Beach"] },
        "baseline",
    );
    store.save(
        context,
        { source: "outing", kind: "comment", id: "p1" },
        { text: ["Meet here"] },
        "true",
    );
    assert.equal(store.list(context).length, 2);
    for (const other of [
        { ...context, space: "trip-b" },
        { ...context, member: "b" },
        { ...context, owner: "another-account" },
    ])
        assert.equal(store.list(other).length, 0);
    assert.equal(D.createStore(storage, () => 101).list(context)[0].values.mustHave[0], "Beach");
});
test("draft values exclude passwords, credentials, file data and arbitrary provider fields", () => {
    assert.deepEqual(
        D.cleanValues("preferences", {
            mustHave: ["<b>Beach</b>"],
            password: ["secret"],
            token: ["token"],
            photos: ["provider"],
        }),
        { mustHave: ["<b>Beach</b>"] },
    );
    assert.deepEqual(
        D.cleanValues("upload", { caption: ["My own caption"], photo: ["binary"], own: ["on"] }),
        { caption: ["My own caption"] },
    );
});
test("drafts expire, successful removal is durable and quota errors retain in-memory work", () => {
    let now = 100;
    const storage = memory(),
        store = D.createStore(storage, () => now);
    const record = store.save(
        context,
        { source: "plan", kind: "preferences" },
        { mustHave: ["Beach"] },
        "baseline",
    );
    store.remove(record.key);
    assert.equal(store.list(context).length, 0);
    store.save(
        context,
        { source: "plan", kind: "preferences" },
        { mustHave: ["Beach"] },
        "baseline",
    );
    now += 8 * 86400000;
    assert.equal(store.list(context).length, 0);
    const blocked = D.createStore(
        {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota");
            },
        },
        () => 100,
    );
    blocked.save(
        context,
        { source: "plan", kind: "preferences" },
        { mustHave: ["Keep my work"] },
        "baseline",
    );
    assert.equal(blocked.available(), false);
    assert.equal(blocked.list(context)[0].values.mustHave[0], "Keep my work");
});
test("private draft storage is bounded independently of shared plan limits", () => {
    const store = D.createStore(memory(), () => 100);
    for (let i = 0; i < 70; i++)
        store.save(
            context,
            { source: "outing", kind: "comment", id: String(i) },
            { text: ["x".repeat(3000)] },
            "true",
        );
    assert.equal(store.list(context).length, 60);
    assert.equal(store.list(context)[0].values.text[0].length, 2000);
});
