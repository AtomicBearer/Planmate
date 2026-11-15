"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPlannerServer } = require("./server-fixture");
const catalogue = require("../shared/catalogue.js");
const publicFiles = require("../server/public-files.js");
const { resolvePublicFile } = require("../server/static-files.js");
const trip = {
    title: "Our Goa trip",
    city: "Goa",
    start: "2026-10-09",
    end: "2026-10-11",
    budget: 5000,
};
async function start(dataFile = null) {
    const server = createPlannerServer({ dataFile });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const call = async (route, method = "GET", body, token, headers = {}) => {
        const response = await fetch(url + route, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...headers,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, data: await response.json() };
    };
    return { server, url, call };
}
async function close(server) {
    await new Promise((resolve) => server.close(resolve));
}

test("every linked browser file is served with the correct type and internal tools remain private", async () => {
    const { server, url } = await start();
    const types = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
        ".ttf": "font/ttf",
    };
    try {
        for (const file of publicFiles) {
            const response = await fetch(`${url}/${file}`);
            assert.equal(response.status, 200, file);
            assert.equal(
                response.headers.get("content-type").split(";")[0],
                types[path.extname(file)],
                file,
            );
            assert.deepEqual(
                Buffer.from(await response.arrayBuffer()),
                fs.readFileSync(resolvePublicFile(file).absolute),
                file,
            );
        }
        for (const file of [
            "public-files.js",
            "scripts/check-project.js",
            "pnpm-lock.yaml",
            ".prettierrc.json",
        ]) {
            assert.equal((await fetch(`${url}/${file}`)).status, 404, file);
        }
    } finally {
        await close(server);
    }
});
test("separate friends join, propose, vote, schedule and observe shared state", async () => {
    const { server, call } = await start();
    try {
        const created = await call("/api/groups", "POST", { trip, name: "Aarav" });
        assert.equal(created.status, 201);
        const { code, token } = created.data,
            route = `/api/groups/${code}`;
        assert.equal((await call(route)).status, 401);
        const joined = await call(route + "/join", "POST", {
            name: "Riya",
            invite: created.data.invite,
        });
        assert.equal(joined.status, 201);
        assert.notEqual(joined.data.memberId, created.data.memberId);
        let state = joined.data.state;
        const proposed = await call(
            route + "/commands",
            "POST",
            {
                revision: state.revision,
                type: "propose",
                payload: { id: "idea", place: catalogue.places[0], note: "Sunrise walk?" },
            },
            joined.data.token,
        );
        assert.equal(proposed.status, 200);
        state = proposed.data.state;
        assert.equal(state.proposals[0].by, joined.data.memberId);
        const voted = await call(
            route + "/commands",
            "POST",
            { revision: state.revision, type: "vote", payload: { id: "idea" } },
            token,
        );
        assert.equal(voted.status, 200);
        state = voted.data.state;
        const planned = await call(
            route + "/commands",
            "POST",
            {
                revision: state.revision,
                type: "schedule",
                payload: {
                    id: "stop",
                    proposalId: "idea",
                    date: trip.start,
                    start: "09:00",
                    end: "11:00",
                    travel: 0,
                    cost: 0,
                    note: "Meet at 9",
                },
            },
            token,
        );
        assert.equal(planned.status, 200);
        const observed = await call(route, "GET", null, joined.data.token);
        assert.equal(observed.data.state.stops[0].note, "Meet at 9");
        assert.equal(observed.data.state.proposals[0].votes.length, 2);
        assert.equal("tokens" in observed.data, false);
        const renamed = await call(
            route + "/commands",
            "POST",
            {
                revision: observed.data.state.revision,
                type: "updateMember",
                payload: { name: "Riya Patel", memberId: created.data.memberId },
            },
            joined.data.token,
        );
        assert.equal(renamed.status, 200);
        assert.equal(
            renamed.data.state.members.find((m) => m.id === joined.data.memberId).name,
            "Riya Patel",
        );
        assert.equal(
            renamed.data.state.members.find((m) => m.id === created.data.memberId).name,
            "Aarav",
        );
        assert.equal(
            (
                await call(
                    route + "/commands",
                    "POST",
                    {
                        revision: observed.data.state.revision,
                        type: "removeStop",
                        payload: { id: "stop" },
                    },
                    "x".repeat(43),
                )
            ).status,
            401,
        );
    } finally {
        await close(server);
    }
});
test("concurrent changes accept one revision and reject the stale writer", async () => {
    const { server, call } = await start();
    try {
        const { data: g } = await call("/api/groups", "POST", { trip, name: "Aarav" });
        const responses = await Promise.all(
            [0, 1].map((i) =>
                call(
                    `/api/groups/${g.code}/commands`,
                    "POST",
                    {
                        revision: 0,
                        type: "propose",
                        payload: { id: `idea-${i}`, place: catalogue.places[i] },
                    },
                    g.token,
                ),
            ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const result = await call(`/api/groups/${g.code}`, "GET", null, g.token);
        assert.equal(result.data.state.proposals.length, 1);
    } finally {
        await close(server);
    }
});
test("persistent plans survive restart, tokens and internal files are not served", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planmate-test-")),
        dataFile = path.join(directory, "plans.json");
    let app = await start(dataFile),
        created;
    try {
        created = (await app.call("/api/groups", "POST", { trip, name: "Aarav" })).data;
        const disk = fs.readFileSync(dataFile.replace(/\.json$/, "") + ".sqlite").toString("utf8");
        assert.ok(!disk.includes(created.token));
        for (const file of [
            "/data/plans.json",
            "/server.js",
            "/package.json",
            "/.env",
            "/../server.js",
        ])
            assert.equal((await fetch(app.url + file)).status, 404);
        assert.equal(
            (
                await app.call("/api/groups", "POST", { trip, name: "Nobody" }, null, {
                    Origin: "https://elsewhere.example",
                })
            ).status,
            403,
        );
        assert.equal((await fetch(app.url + "/dashboard.html")).status, 200);
        for (const file of ["/profile.html", "/profile.css", "/profile.js", "/profile-store.js"])
            assert.equal((await fetch(app.url + file)).status, 200);
        await close(app.server);
        app = await start(dataFile);
        const restored = await app.call(`/api/groups/${created.code}`, "GET", null, created.token);
        assert.equal(restored.status, 200);
        assert.equal(restored.data.state.trip.title, trip.title);
    } finally {
        await close(app.server);
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
