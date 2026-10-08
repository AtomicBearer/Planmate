"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path"),
    { createPlannerServer } = require("./server-fixture"),
    catalogue = require("../shared/catalogue.js");
const trip = {
    title: "Shared feature check",
    city: "Goa",
    start: "2026-10-09",
    end: "2026-10-11",
    budget: 5000,
};
const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
    "base64",
);

test("removing a member during an in-flight provider request revokes its result", async () => {
    let release, started;
    const gate = new Promise((resolve) => {
            release = resolve;
        }),
        providerStarted = new Promise((resolve) => {
            started = resolve;
        });
    const server = createPlannerServer({
        dataFile: null,
        discoveryOptions: { env: {} },
        mapOptions: {
            env: { ROUTES_FEED_URL: "https://routes.fixture.example" },
            fetchImpl: async () => {
                started();
                await gate;
                return new Response(
                    JSON.stringify({
                        durationSeconds: 600,
                        distanceMeters: 1000,
                        provider: "Fixture",
                        sourceUrl: "https://routes.fixture.example/result",
                    }),
                    { headers: { "Content-Type": "application/json" } },
                );
            },
        },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(route, token, value) {
        const response = await fetch(base + route, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(value),
        });
        return { status: response.status, ...(await response.json()) };
    }
    try {
        const host = await call("/api/groups", null, { trip, name: "Host" }),
            route = `/api/groups/${host.code}`,
            friend = await call(route + "/join", null, { name: "Friend", invite: host.invite });
        let state = friend.state;
        async function cmd(type, payload) {
            const result = await call(route + "/commands", host.token, {
                revision: state.revision,
                type,
                payload,
            });
            assert.equal(result.status, 200, result.error);
            state = result.state;
        }
        for (let i = 0; i < 2; i++) {
            await cmd("propose", {
                id: "p" + i,
                place: {
                    ...catalogue.places[i],
                    coordinates: {
                        latitude: 15.5 + i / 100,
                        longitude: 73.8,
                        source: "https://coordinates.fixture.example",
                    },
                },
            });
            await cmd("schedule", {
                id: "s" + i,
                proposalId: "p" + i,
                date: trip.start,
                start: i ? "12:00" : "10:00",
                end: i ? "13:00" : "11:00",
                travel: 0,
                cost: 0,
            });
        }
        const pending = call(route + "/route", friend.token, { fromId: "s0", toId: "s1" });
        await providerStarted;
        await cmd("removeMember", { memberId: friend.memberId });
        release();
        assert.equal((await pending).status, 401);
    } finally {
        release();
        await new Promise((resolve) => server.close(resolve));
    }
});
test("shared permissions, comments, expenses and private media persist and protect concurrent edits", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planmate-features-")),
        file = path.join(directory, "plans.json");
    let server, base;
    async function start() {
        server = createPlannerServer({ dataFile: file, discoveryOptions: { env: {} } });
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        base = `http://127.0.0.1:${server.address().port}`;
    }
    async function call(route, token, body, method = body ? "POST" : "GET") {
        const r = await fetch(base + route, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, ...(await r.json()) };
    }
    await start();
    try {
        const host = await call("/api/groups", null, { trip, name: "Host" }),
            route = `/api/groups/${host.code}`,
            friend = await call(route + "/join", null, { name: "Friend", invite: host.invite }),
            outsider = await call("/api/groups", null, { trip, name: "Other trip" });
        let state = friend.state;
        async function cmd(type, payload = {}, token = host.token) {
            const r = await call(route + "/commands", token, {
                revision: state.revision,
                type,
                payload,
            });
            if (r.state) state = r.state;
            return r;
        }
        assert.equal(
            (
                await cmd(
                    "addAvailability",
                    { id: "d", date: trip.start, start: "09:00", end: "22:00" },
                    friend.token,
                )
            ).status,
            400,
        );
        await cmd("addAvailability", { id: "d", date: trip.start, start: "09:00", end: "22:00" });
        await cmd("respondAvailability", { options: ["d"] }, friend.token);
        await cmd("propose", { id: "p", place: catalogue.places[0] });
        await cmd("schedule", {
            id: "stop",
            proposalId: "p",
            date: trip.start,
            start: "10:00",
            end: "11:00",
            cost: 0,
            travel: 0,
        });
        await cmd(
            "addComment",
            { proposalId: "p", id: "c", text: "Member discussion" },
            friend.token,
        );
        assert.equal((await cmd("deleteComment", { proposalId: "p", id: "c" })).status, 400);
        const revision = state.revision;
        const edits = await Promise.all(
            [host.token, friend.token].map((token, i) =>
                call(route + "/commands", token, {
                    revision,
                    type: "respondSuggestion",
                    payload: { id: "p", response: i ? "maybe" : "interested" },
                }),
            ),
        );
        assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
        state = (await call(route, host.token)).state;
        await cmd(
            "addExpense",
            {
                id: "lunch",
                description: "Paid lunch",
                amountPaise: 10001,
                payer: host.memberId,
                participants: [host.memberId, friend.memberId],
                split: "equal",
            },
            friend.token,
        );
        assert.equal(
            state.expenses[0].shares[host.memberId] + state.expenses[0].shares[friend.memberId],
            10001,
        );
        await cmd("markVisited", { id: "stop", visited: true }, friend.token);
        async function upload(bytes, type, revision = state.revision, token = friend.token) {
            const r = await fetch(
                `${base}${route}/photos?${new URLSearchParams({ stopId: "stop", caption: "A <safe> caption", revision: String(revision) })}`,
                {
                    method: "POST",
                    headers: { "Content-Type": type, Authorization: `Bearer ${token}` },
                    body: bytes,
                },
            );
            return { status: r.status, ...(await r.json()) };
        }
        assert.equal((await upload(Buffer.from("not a photo"), "image/png")).status, 400);
        assert.equal((await upload(pixel, "image/svg+xml")).status, 415);
        assert.equal((await upload(pixel, "image/png", state.revision - 1)).status, 409);
        assert.equal(
            (await upload(pixel, "image/png", state.revision, outsider.token)).status,
            401,
        );
        const uploaded = await upload(pixel, "image/png");
        assert.equal(uploaded.status, 201);
        state = uploaded.state;
        const photo = state.scrapbook[0];
        assert.equal(photo.by, friend.memberId);
        assert.equal(photo.caption, "A <safe> caption");
        assert.equal((await fetch(base + route + "/photos/" + photo.id)).status, 401);
        assert.equal(
            (
                await fetch(base + route + "/photos/" + photo.id, {
                    headers: { Authorization: `Bearer ${outsider.token}` },
                })
            ).status,
            401,
        );
        let image = await fetch(base + route + "/photos/" + photo.id, {
            headers: { Authorization: `Bearer ${host.token}` },
        });
        assert.deepEqual(
            await require("sharp")(Buffer.from(await image.arrayBuffer()))
                .raw()
                .toBuffer(),
            await require("sharp")(pixel).raw().toBuffer(),
        );
        assert.equal((await cmd("deletePhoto", { id: photo.id })).status, 400);
        assert.equal((await cmd("removeStop", { id: "stop" })).status, 400);
        assert.ok(fs.existsSync(path.join(directory, "media", host.code, photo.id)));
        assert.ok(
            !fs
                .readFileSync(file.replace(/\.json$/, "") + ".sqlite")
                .toString("utf8")
                .includes(pixel.toString("base64")),
        );
        await new Promise((r) => server.close(r));
        await start();
        state = (await call(route, friend.token)).state;
        assert.equal(state.expenses[0].description, "Paid lunch");
        assert.equal(state.proposals[0].comments[0].text, "Member discussion");
        assert.equal(state.scrapbook[0].id, photo.id);
        image = await fetch(base + route + "/photos/" + photo.id, {
            headers: { Authorization: `Bearer ${friend.token}` },
        });
        assert.equal(image.status, 200);
        const uploadedPath = path.join(directory, "media", host.code, photo.id),
            retainedImage = fs.readFileSync(uploadedPath);
        fs.unlinkSync(uploadedPath);
        const missing = await call(route + "/photos/" + photo.id, friend.token);
        assert.equal(missing.status, 404);
        assert.match(missing.error, /file is missing/);
        fs.writeFileSync(uploadedPath, retainedImage);
        await cmd("editCaption", { id: photo.id, caption: "Changed" }, friend.token);
        await cmd("deletePhoto", { id: photo.id }, friend.token);
        assert.equal(
            (
                await fetch(base + route + "/photos/" + photo.id, {
                    headers: { Authorization: `Bearer ${friend.token}` },
                })
            ).status,
            404,
        );
        assert.equal(fs.existsSync(path.join(directory, "media", host.code, photo.id)), false);
    } finally {
        await new Promise((r) => server.close(r));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
