const assert = require("node:assert/strict");
const { launchBrowser } = require("./helpers.cjs");
const { createPlannerServer } = require("../server-fixture");
(async () => {
    const server = createPlannerServer({ dataFile: null });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser();
    try {
        const response = await fetch(base + "/api/groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Host",
                trip: {
                    title: "Our shared trip",
                    city: "Goa",
                    start: "2026-10-09",
                    end: "2026-10-11",
                    budget: 5000,
                },
            }),
        });
        const g = await response.json();
        const context = await browser.newContext();
        const page = await context.newPage(),
            errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/api/health", async (route) => {
            await new Promise((r) => setTimeout(r, 500));
            await route.continue();
        });
        await page.goto(base + "/dashboard.html?group=" + g.code + "&invite=" + g.invite);
        await page
            .getByRole("heading", { name: "Your shared planning space", exact: true })
            .waitFor();
        assert.equal(await page.locator(".hero").isVisible(), false);
        assert.equal(await page.locator("#entryGuide").isVisible(), false);
        assert.equal(await page.locator("#mobileView").isDisabled(), true);
        assert.equal(await page.locator('#sideNav [data-view="ideas"]').isDisabled(), true);
        await page.locator('[data-form="join"] [name="name"]').fill("Friend");
        await page.getByRole("button", { name: "Join the planning space", exact: true }).click();
        await page.getByRole("heading", { name: "Our shared trip" }).waitFor();
        assert.equal(await page.locator("#sideNav .active").getAttribute("data-view"), "group");
        assert.equal(await page.locator('#sideNav [data-view="ideas"]').isDisabled(), false);
        await page.getByText("Unanswered: Host, Friend", { exact: true }).waitFor();
        assert.equal(await page.getByText("Confirmed: Friend", { exact: true }).count(), 0);
        await page.unroute("**/api/health");
        await page.route("**/api/health", (route) => route.abort());
        await page.goto(base + "/dashboard.html?group=" + g.code);
        await page
            .getByText(
                "We couldn’t open the shared trip. Check your connection and reload to try again.",
            )
            .waitFor();
        assert.equal(await page.locator(".hero").isVisible(), false);
        await page.getByRole("link", { name: "Open my browser plans" }).click();
        await page.getByRole("heading", { name: "Your next adventure starts here" }).waitFor();
        assert.equal(await page.locator('#sideNav [data-view="ideas"]').isDisabled(), false);
        assert.deepEqual(errors, []);
        console.log(
            "PASS: shared loading never displays another trip, fresh invite join starts at dates/attendance without marking attendance, connection errors retain access to device plans",
        );
        await context.close();
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
