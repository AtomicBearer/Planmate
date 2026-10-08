const assert = require("node:assert/strict"),
    { launchBrowser } = require("./helpers.cjs"),
    { createPlannerServer } = require("../server-fixture"),
    sharp = require("sharp");
(async () => {
    let calls = 0;
    const server = createPlannerServer({
        dataFile: null,
        discoveryOptions: {
            env: { GOOGLE_PLACES_API_KEY: "fixture" },
            fetchImpl: async () => {
                calls++;
                return {
                    ok: true,
                    json: async () => ({
                        places: [
                            {
                                id: "fixture",
                                displayName: { text: "Fixture Goa cafe" },
                                formattedAddress: "Anjuna, Goa, India",
                                types: ["cafe"],
                                photos: [
                                    {
                                        name: "places/fixture/photos/photo",
                                        authorAttributions: [
                                            {
                                                displayName: "Fixture photographer",
                                                uri: "https://example.org/credit",
                                            },
                                        ],
                                    },
                                ],
                                googleMapsUri: "https://maps.google.com/?cid=fixture",
                            },
                        ],
                    }),
                };
            },
        },
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = "http://127.0.0.1:" + server.address().port,
        browser = await launchBrowser();
    try {
        const c = await browser.newContext(),
            p = await c.newPage(),
            errors = [];
        p.on("pageerror", (e) => errors.push(e.message));
        let photos = 0;
        const pixel = await sharp({
            create: { width: 20, height: 20, channels: 3, background: "#eee" },
        })
            .png()
            .toBuffer();
        await p.route("**/api/discovery/photo?*", (route) => {
            photos++;
            return route.fulfill({ status: 200, contentType: "image/png", body: pixel });
        });
        const g = await (
            await fetch(base + "/api/groups", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    name: "Host",
                    trip: {
                        title: "Discovery fixture",
                        city: "Goa",
                        start: "2026-10-09",
                        end: "2026-10-11",
                        budget: 5000,
                    },
                }),
            })
        ).json();
        await p.goto(base + "/dashboard.html");
        await p.evaluate(
            (g) =>
                localStorage.setItem(
                    "planmateSessionsV1",
                    JSON.stringify({ [g.code]: { token: g.token, memberId: g.memberId } }),
                ),
            g,
        );
        await p.goto(base + "/dashboard.html?group=" + g.code + "&view=discover");
        await p.getByRole("heading", { name: "Discovery fixture" }).waitFor();
        await p.getByRole("button", { name: "Find more places", exact: true }).click();
        const img = p.getByAltText("Fixture Goa cafe", { exact: true });
        await img.scrollIntoViewIfNeeded();
        await p.waitForFunction(() =>
            [...document.images].some((i) => i.alt === "Fixture Goa cafe" && i.naturalWidth === 20),
        );
        assert.equal(photos, 1);
        await p.getByText("Fixture photographer", { exact: true }).waitFor();
        assert.equal(calls, 3);
        const joined = await fetch(base + "/api/groups/" + g.code + "/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Friend", invite: g.invite }),
        });
        assert.equal(joined.status, 201);
        await p.waitForTimeout(4600);
        assert.equal(
            photos,
            1,
            "shared refresh reuses loaded venue image without another billable photo lookup",
        );
        assert.equal(calls, 3, "shared refresh does not rerun discovery");
        assert.deepEqual(errors, []);
        console.log(
            "PASS discovery UI: provider photo attribution, lazy load, shared refresh image reuse and bounded searches (fixtures)",
        );
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
