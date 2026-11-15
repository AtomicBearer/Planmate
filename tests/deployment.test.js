"use strict";
const { test } = require("node:test"),
    { once, EventEmitter } = require("node:events"),
    assert = require("node:assert/strict"),
    fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path"),
    http = require("node:http"),
    { createPlannerServer } = require("./server-fixture"),
    { createPlanStore } = require("../server/storage/plan-store"),
    { publicOrigin } = require("../server/deployment-config"),
    { checkLaunch } = require("../scripts/check-launch");
const trip = {
    title: "My own trip",
    city: "Goa",
    start: "2026-10-09",
    end: "2026-10-10",
    budget: 3000,
};
async function listen(options) {
    const server = createPlannerServer(options);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
const close = (server) => new Promise((resolve) => server.close(resolve));
async function json(origin, route, options = {}) {
    const response = await fetch(origin + route, options);
    assert.equal(response.ok, true, await response.clone().text());
    return response.json();
}
const post = (data, token) => ({
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
});

test("provider-free guest hosting passes preflight and uses the assigned origin, with explicit custom-domain precedence", () => {
    const env = {
        HOST: "0.0.0.0",
        SESSION_SECURE: "true",
        ACCOUNT_MODE: "guest",
        PLANMATE_DATA_DIR: path.resolve(os.tmpdir(), "planmate-host"),
        RENDER_EXTERNAL_URL: "https://planmate.onrender.com",
    };
    assert.deepEqual(checkLaunch(env).errors, []);
    assert.equal(publicOrigin(env), env.RENDER_EXTERNAL_URL);
    assert.equal(
        publicOrigin({ ...env, PUBLIC_ORIGIN: "https://trips.example.test" }),
        "https://trips.example.test",
    );
    assert.ok(
        checkLaunch({ ...env, PUBLIC_ORIGIN: "https://trips.example.test/path" }).errors.length,
    );
    assert.ok(
        checkLaunch({ ...env, RENDER_EXTERNAL_URL: "http://planmate.onrender.com" }).errors.length,
    );
});

test("fresh persistent storage has no trips; guest changes survive restart without contacting external providers", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planmate-release-")),
        dataFile = path.join(directory, "plans.json");
    let networkCalls = 0,
        app;
    const fetchImpl = async () => {
            networkCalls++;
            throw new Error("Unexpected external request");
        },
        options = {
            dataFile,
            discoveryOptions: { env: {}, fetchImpl },
            mapOptions: { env: {}, fetchImpl },
        };
    try {
        app = await listen(options);
        let store = createPlanStore({ file: path.join(directory, "plans.sqlite") });
        assert.deepEqual(store.snapshot().groups, {});
        store.close();
        const status = await json(app.origin, "/api/integrations/status");
        assert.equal(
            status.services.every((s) => !s.configured),
            true,
        );
        const health = await json(app.origin, "/api/health");
        assert.equal(health.mode, "guest");
        assert.deepEqual(health.map, { googleMap: false, routes: false, routeProvider: "" });
        const owner = await json(app.origin, "/api/groups", post({ trip, name: "Maya" }));
        assert.equal(owner.state.members.length, 1);
        assert.equal(owner.state.stops.length, 0);
        assert.equal(owner.state.proposals.length, 0);
        const route = `/api/groups/${owner.code}`,
            friend = await json(
                app.origin,
                route + "/join",
                post({ name: "Riya", invite: owner.invite }),
            );
        const changed = await json(
            app.origin,
            route + "/commands",
            post(
                {
                    revision: friend.state.revision,
                    type: "addAvailability",
                    payload: { id: "our-window", date: trip.start, start: "10:00", end: "14:00" },
                },
                owner.token,
            ),
        );
        await close(app.server);
        app = await listen(options);
        const restored = await json(app.origin, route, {
            headers: { Authorization: `Bearer ${friend.token}` },
        });
        assert.equal(restored.state.revision, changed.state.revision);
        assert.equal(restored.state.members.length, 2);
        assert.equal(restored.state.availability.options[0].id, "our-window");
        assert.equal((await fetch(app.origin + route)).status, 401);
        for (const privateFile of [
            "/.env",
            "/data/plans.sqlite",
            "/render.yaml",
            "/server/deployment-config.js",
            "/licenses/web-fonts/README.md",
        ])
            assert.equal((await fetch(app.origin + privateFile)).status, 404, privateFile);
        assert.equal(networkCalls, 0);
    } finally {
        if (app?.server.listening) await close(app.server);
        // This is the exact disposable directory created above, never project storage.
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("the assigned public origin rejects foreign mutations without blocking same-origin guests", async () => {
    const app = await listen({
        accountOptions: {
            env: { ACCOUNT_MODE: "guest", RENDER_EXTERNAL_URL: "https://planmate.example.test" },
        },
    });
    try {
        const options = post({ trip, name: "Maya" });
        const rejected = await fetch(app.origin + "/api/groups", {
            ...options,
            headers: { ...options.headers, Origin: "https://foreign.example.test" },
        });
        assert.equal(rejected.status, 403);
        // A host's reverse proxy forwards the public Host header. Use raw HTTP here:
        // fetch/Undici manages Host itself rather than honoring this header override.
        const accepted = await new Promise((resolve, reject) => {
            const request = http.request(
                app.origin + "/api/groups",
                {
                    method: "POST",
                    headers: {
                        ...options.headers,
                        Origin: "https://planmate.example.test",
                        Host: "planmate.example.test",
                    },
                },
                (response) => {
                    response.resume();
                    response.on("end", () => resolve(response.statusCode));
                },
            );
            request.on("error", reject);
            request.end(options.body);
        });
        assert.equal(accepted, 201);
    } finally {
        await close(app.server);
    }
});

test("fragmented UTF-8 JSON preserves Indian-language member names", async () => {
    const app = await listen();
    try {
        const name = "आर्या",
            data = Buffer.from(JSON.stringify({ trip, name })),
            split = data.indexOf(Buffer.from(name)) + 1;
        const result = await new Promise((resolve, reject) => {
            const request = http.request(
                app.origin + "/api/groups",
                { method: "POST", headers: { "Content-Type": "application/json" } },
                (response) => {
                    let raw = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk) => (raw += chunk));
                    response.on("end", () =>
                        resolve({ status: response.statusCode, data: JSON.parse(raw) }),
                    );
                },
            );
            request.on("error", reject);
            request.write(data.subarray(0, split));
            setTimeout(() => request.end(data.subarray(split)), 20);
        });
        assert.equal(result.status, 201);
        assert.equal(result.data.state.members[0].name, name);
    } finally {
        await close(app.server);
    }
});

test("host termination drains the running server, releases storage and removes signal listeners", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planmate-shutdown-")),
        settings = {
            PORT: "0",
            HOST: "127.0.0.1",
            PLANMATE_DATA_DIR: directory,
            ACCOUNT_MODE: "guest",
            GOOGLE_CLIENT_ID: "",
            PUBLIC_ORIGIN: "",
            RENDER_EXTERNAL_URL: "",
        },
        previous = new Map(Object.keys(settings).map((key) => [key, process.env[key]])),
        signals = new EventEmitter(),
        listeners = signals.listenerCount("SIGTERM");
    let server;
    try {
        Object.assign(process.env, settings);
        server = require("../server/index").start({ signals });
        await once(server, "listening");
        assert.equal(signals.listenerCount("SIGTERM"), listeners + 1);
        const closed = once(server, "close");
        // Invoke the handler as the host would, without signaling another process.
        signals.emit("SIGTERM");
        await closed;
        assert.equal(server.listening, false);
        assert.equal(signals.listenerCount("SIGTERM"), listeners);
        const store = createPlanStore({ file: path.join(directory, "plans.sqlite") });
        assert.deepEqual(store.snapshot().groups, {});
        store.close();
    } finally {
        if (server?.listening) await close(server);
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
