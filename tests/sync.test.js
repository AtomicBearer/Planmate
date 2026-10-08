"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    Sync = require("../shared-sync"),
    Nav = require("../dashboard-navigation");
test("delayed shared refresh cannot roll back a newer local save or leak into another trip/member", async () => {
    let context = { code: "trip", member: "a" },
        revision = 5,
        received = [],
        done;
    const sync = Sync.create({
        context: () => context,
        busy: () => false,
        revision: () => revision,
        request: () => new Promise((r) => (done = r)),
        receive: (s) => received.push(s.revision),
        status() {},
        error(e) {
            throw e;
        },
    });
    const first = sync.refresh();
    revision = 7;
    done({ state: { revision: 6 } });
    await first;
    assert.deepEqual(received, []);
    const second = sync.refresh();
    context = { code: "other", member: "b" };
    done({ state: { revision: 10 } });
    await second;
    assert.deepEqual(received, []);
    const third = sync.refresh();
    done({ state: { revision: 8 } });
    await third;
    assert.deepEqual(received, [8]);
});
test("navigation keeps the selected trip, day and page while local spaces stay distinct", () => {
    assert.equal(
        Nav.context({
            view: "today",
            day: "2026-10-10",
            group: "shared",
            space: "local",
        }).toString(),
        "view=today&day=2026-10-10&group=shared",
    );
    assert.equal(Nav.context({ view: "fit", space: "private" }).get("space"), "private");
});
