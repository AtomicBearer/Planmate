"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    { createPlannerServer } = require("./server-fixture"),
    Core = require("../shared/planner-core.js"),
    { createPlanStore } = require("../server/storage/plan-store.js"),
    fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    sharp = require("sharp"),
    { processImage } = require("../server/services/media-store.js");
const trip = {
    title: "Account fixture",
    city: "Goa",
    start: "2026-10-09",
    end: "2026-10-11",
    budget: 5000,
};
async function setup(options = {}) {
    const server = createPlannerServer({
        dataFile: options.dataFile ?? null,
        accountOptions: {
            env: { GOOGLE_CLIENT_ID: "fixture-client", ACCOUNT_MODE: "required" },
            verify: async (credential) => JSON.parse(credential),
        },
        discoveryOptions: { env: {} },
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    function client() {
        let cookies = {},
            csrf = "";
        return {
            async call(route, method = "GET", value, withCsrf = true, extraHeaders = {}) {
                const r = await fetch(base + route, {
                    method,
                    headers: {
                        "Content-Type": "application/json",
                        Cookie: Object.entries(cookies)
                            .map(([k, v]) => `${k}=${v}`)
                            .join("; "),
                        ...(withCsrf && csrf ? { "X-Planmate-CSRF": csrf } : {}),
                        ...extraHeaders,
                    },
                    ...(value ? { body: JSON.stringify(value) } : {}),
                });
                for (const c of r.headers.getSetCookie()) {
                    const [k, v] = c.split(";")[0].split("=");
                    cookies[k] = v;
                }
                const data = await r.json();
                if (data.account) csrf = data.account.csrf;
                return { status: r.status, data, cookie: r.headers.get("set-cookie") };
            },
            async login(sub, extra = {}) {
                const c = await this.call("/api/auth/challenge");
                const claims = {
                    sub,
                    name: sub,
                    email: sub + "@fixture.example",
                    email_verified: true,
                    aud: "fixture-client",
                    iss: "https://accounts.google.com",
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    nonce: c.data.nonce,
                    ...extra,
                };
                const r = await this.call("/api/auth/google", "POST", {
                    credential: JSON.stringify(claims),
                });
                if (r.status === 200) await this.call("/api/auth/session");
                return r;
            },
        };
    }
    return { server, base, client };
}
test("backup and restore include member photos and private accounts, validate checksums and revoke restored sessions", async () => {
    const { backup, restore } = require("../scripts/backup");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planmate-backup-")),
        source = path.join(dir, "source"),
        copy = path.join(dir, "backup"),
        target = path.join(dir, "restored");
    const store = createPlanStore({ file: path.join(source, "plans.sqlite") }),
        code = "1234567890123456",
        id = "00000000-0000-0000-0000-000000000000.png",
        state = Core.createState(trip, { id: "a", name: "A" });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
        .png()
        .toBuffer();
    state.scrapbook = [{ id, by: "a", stopId: "s", size: bytes.length, type: "image/png" }];
    store.commit(store.snapshot(), { version: 1, groups: { [code]: { state, tokens: {} } } });
    store.db
        .prepare("INSERT INTO accounts(id,subject,name,email,profile) VALUES(?,?,?,?,?)")
        .run("a", "sub", "A", "fixture@example.org", "{}");
    store.db
        .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
        .run("hash", "a", "csrf", Date.now() + 10000);
    store.close();
    fs.mkdirSync(path.join(source, "media", code), { recursive: true });
    fs.writeFileSync(path.join(source, "media", code, id), bytes);
    try {
        backup(source, copy);
        restore(copy, target);
        const restored = createPlanStore({ file: path.join(target, "plans.sqlite") });
        assert.equal(restored.snapshot().groups[code].state.scrapbook[0].id, id);
        assert.equal(restored.db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1);
        assert.equal(restored.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
        restored.close();
        assert.deepEqual(fs.readFileSync(path.join(target, "media", code, id)), bytes);
        assert.throws(() => restore(copy, target), /new directory/);
        fs.writeFileSync(path.join(copy, "media", code, id), "damaged");
        assert.throws(() => restore(copy, path.join(dir, "bad")), /checksum/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
test("verified identity checks, nonce replay and session CSRF fail closed; sessions can be invalidated across devices", async () => {
    const a = await setup();
    try {
        const c = a.client();
        for (const claims of [
            { aud: "other" },
            { iss: "other" },
            { exp: 1 },
            { email_verified: false },
            { nonce: "wrong" },
        ])
            assert.equal((await c.login("A", claims)).status, 401);
        const ok = await c.login("A");
        assert.equal(ok.status, 200);
        assert.match(ok.cookie, /HttpOnly/);
        assert.match(ok.cookie, /SameSite=Lax/);
        assert.equal((await c.call("/api/groups", "POST", { trip, name: "A" }, false)).status, 403);
        const second = a.client();
        await second.login("A");
        assert.equal((await c.call("/api/auth/signout", "POST", { allDevices: true })).status, 200);
        assert.equal((await second.call("/api/auth/session")).data.account, null);
        assert.equal((await second.call("/api/groups", "POST", { trip, name: "A" })).status, 401);
        const challenge = await c.call("/api/auth/challenge"),
            claims = {
                sub: "A",
                email_verified: true,
                aud: "fixture-client",
                iss: "accounts.google.com",
                exp: Math.floor(Date.now() / 1000) + 3600,
                nonce: challenge.data.nonce,
            };
        assert.equal(
            (await c.call("/api/auth/google", "POST", { credential: JSON.stringify(claims) }))
                .status,
            200,
        );
        assert.equal(
            (await c.call("/api/auth/google", "POST", { credential: JSON.stringify(claims) }))
                .status,
            403,
        );
    } finally {
        await new Promise((r) => a.server.close(r));
    }
});
test("private cross-device profiles, duplicate account membership, invitation revocation and organizer transfer preserve history", async () => {
    const a = await setup();
    try {
        const host = a.client(),
            friend = a.client();
        await host.login("Host");
        await friend.login("Friend");
        const g = (await host.call("/api/groups", "POST", { trip, name: "Host" })).data,
            route = "/api/groups/" + g.code;
        assert.equal(g.token, null);
        assert.equal((await friend.call(route + "/join", "POST", { name: "Friend" })).status, 403);
        const joined = (
            await friend.call(route + "/join", "POST", { name: "Friend", invite: g.invite })
        ).data;
        const again = (
            await friend.call(route + "/join", "POST", { name: "duplicate", invite: g.invite })
        ).data;
        assert.equal(again.memberId, joined.memberId);
        assert.equal(again.state.members.length, 2);
        const second = a.client();
        await second.login("Host");
        const profile = (await host.call("/api/profile")).data;
        assert.equal(
            (
                await host.call("/api/profile", "PUT", {
                    revision: profile.revision,
                    profile: {
                        name: "Host",
                        hobbies: ["Photography"],
                        wishlist: [{ city: "Goa" }],
                        token: "never saved",
                    },
                })
            ).status,
            200,
        );
        assert.equal((await second.call("/api/profile")).data.profile.wishlist[0].city, "Goa");
        assert.equal(
            (
                await second.call("/api/profile", "PUT", {
                    revision: profile.revision,
                    profile: { name: "stale" },
                })
            ).status,
            409,
        );
        assert.equal((await second.call("/api/profile")).data.profile.token, undefined);
        assert.deepEqual((await host.call(route)).data.state.preferences, {});
        async function cmd(c, type, payload) {
            const s = (await c.call(route)).data.state;
            return c.call(route + "/commands", "POST", { revision: s.revision, type, payload });
        }
        const place = {
            id: "manual",
            name: "Group place",
            city: "Goa",
            category: "Beach",
            area: "Group sourced",
            duration: 60,
            custom: true,
            source: "https://example.org",
        };
        assert.equal((await cmd(friend, "propose", { id: "p", place })).status, 200);
        assert.equal(
            (
                await cmd(host, "addExpense", {
                    id: "e",
                    description: "Paid bill",
                    amountPaise: 10001,
                    payer: g.memberId,
                    participants: [g.memberId, joined.memberId],
                    split: "equal",
                })
            ).status,
            200,
        );
        assert.equal((await cmd(host, "removeMember", { memberId: g.memberId })).status, 400);
        assert.equal(
            (await cmd(friend, "transferOrganizer", { memberId: g.memberId })).status,
            400,
        );
        let s = (await host.call(route)).data.state;
        assert.equal(
            (await host.call(route + "/invite", "POST", { revision: s.revision, action: "revoke" }))
                .status,
            200,
        );
        const third = a.client();
        await third.login("Third");
        assert.equal(
            (await third.call(route + "/join", "POST", { name: "Third", invite: g.invite })).status,
            403,
        );
        assert.equal(
            (await cmd(host, "transferOrganizer", { memberId: joined.memberId })).status,
            200,
        );
        assert.equal((await cmd(friend, "removeMember", { memberId: g.memberId })).status, 200);
        assert.equal((await host.call(route)).status, 401);
        assert.equal(
            (await host.call(route + "/photos/00000000-0000-0000-0000-000000000000.png")).status,
            401,
        );
        s = (await friend.call(route)).data.state;
        assert.equal(s.organizerId, joined.memberId);
        assert.equal(s.members.find((m) => m.id === g.memberId).removed, true);
        assert.equal(s.expenses[0].payer, g.memberId);
        assert.equal(s.proposals[0].by, joined.memberId);
    } finally {
        await new Promise((r) => a.server.close(r));
    }
});
test("SQLite import preserves JSON and every legacy record, is repeatable and checks stale revisions in transactions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planmate-migration-")),
        legacyFile = path.join(dir, "plans.json"),
        file = path.join(dir, "plans.sqlite"),
        code = "1234567890123456";
    const state = Core.createState(trip, { id: "a", name: "Legacy" });
    state.proposals = [
        {
            id: "p",
            by: "a",
            place: { id: "manual", name: "A", city: "Goa", category: "Beach", duration: 60 },
            votes: ["a"],
            status: "pending",
            comments: [
                { id: "c", by: "a", text: "Historical comment", createdAt: "2026-10-08T00:00:00Z" },
            ],
        },
    ];
    const original = JSON.stringify({
        version: 1,
        groups: { [code]: { state, tokens: { hashed: "a" } } },
    });
    fs.writeFileSync(legacyFile, original);
    const one = createPlanStore({ file, legacyFile }),
        two = createPlanStore({ file, legacyFile });
    try {
        assert.equal(fs.readFileSync(legacyFile, "utf8"), original);
        assert.equal(fs.readFileSync(legacyFile + ".pre-sqlite.backup", "utf8"), original);
        const before = one.snapshot(),
            other = two.snapshot(),
            next = Core.clone(before);
        next.groups[code].state = Core.apply(
            next.groups[code].state,
            { type: "updateMember", payload: { name: "Updated" } },
            "a",
        );
        one.commit(before, next);
        const stale = Core.clone(other);
        stale.groups[code].state = Core.apply(
            stale.groups[code].state,
            { type: "updateMember", payload: { name: "Stale" } },
            "a",
        );
        assert.throws(
            () => two.commit(other, stale),
            (e) => e.status === 409,
        );
        assert.equal(
            two.snapshot().groups[code].state.proposals[0].comments[0].text,
            "Historical comment",
        );
    } finally {
        one.close();
        two.close();
    }
    const reopened = createPlanStore({ file, legacyFile });
    assert.equal(Object.keys(reopened.snapshot().groups).length, 1);
    assert.equal(reopened.snapshot().groups[code].state.members[0].name, "Updated");
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
});
test("photo decoding strips camera metadata and rejects structurally plausible corrupt images", async () => {
    const original = await sharp({
        create: { width: 4, height: 3, channels: 3, background: "#eee" },
    })
        .jpeg()
        .withMetadata()
        .toBuffer();
    const output = await processImage(original, "image/jpeg");
    assert.equal((await sharp(output.bytes).metadata()).exif, undefined);
    assert.equal(output.details.width, 4);
    const bad = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE5kAAAAASUVORK5CYII=",
        "base64",
    );
    await assert.rejects(processImage(bad, "image/png"), /decoded safely/);
});
test("legacy claims require token proof, explicit consent and revision; expired invitations cannot join", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planmate-claim-")),
        file = path.join(dir, "plans.json"),
        code = "1234567890123456",
        token = "a".repeat(43),
        key = "b".repeat(32),
        digest = (v) => require("node:crypto").createHash("sha256").update(v).digest("hex");
    const state = Core.createState(trip, { id: "old-member", name: "Legacy" });
    fs.writeFileSync(
        file,
        JSON.stringify({
            version: 1,
            groups: {
                [code]: {
                    state,
                    tokens: { [digest(token)]: "old-member" },
                    invite: { hash: digest(key), expires: 1, revoked: false },
                },
            },
        }),
    );
    const a = await setup({ dataFile: file });
    try {
        const c = a.client();
        await c.login("Legacy Account");
        const route = "/api/groups/" + code,
            headers = { Authorization: "Bearer " + token };
        assert.equal(
            (await c.call(route + "/join", "POST", { name: "Account", invite: key })).status,
            403,
        );
        assert.equal(
            (await c.call(route + "/claim", "POST", { consent: true, revision: 0 })).status,
            401,
        );
        assert.equal(
            (await c.call(route + "/claim", "POST", { consent: false, revision: 0 }, true, headers))
                .status,
            400,
        );
        assert.equal(
            (await c.call(route + "/claim", "POST", { consent: true, revision: 9 }, true, headers))
                .status,
            409,
        );
        const claimed = await c.call(
            route + "/claim",
            "POST",
            { consent: true, revision: 0 },
            true,
            headers,
        );
        assert.equal(claimed.status, 200);
        assert.equal(claimed.data.memberId, "old-member");
        assert.equal((await c.call(route)).status, 200);
        assert.equal(
            (await c.call(route + "/claim", "POST", { consent: true, revision: 1 }, true, headers))
                .status,
            401,
        );
        const other = a.client();
        assert.equal((await other.call(route, "GET", null, true, headers)).status, 401);
    } finally {
        await new Promise((r) => a.server.close(r));
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
