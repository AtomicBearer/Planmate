"use strict";
const assert = require("node:assert/strict"),
    { createPlannerServer } = require("../server-fixture"),
    { launchBrowser } = require("./helpers.cjs");
(async () => {
    const server = createPlannerServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser();
    try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            reducedMotion: "reduce",
        });
        const page = await context.newPage(),
            errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        let release;
        const ready = new Promise((resolve) => {
            release = resolve;
        });
        await page.route("**/api/integrations/status", async (route) => {
            await ready;
            await route.continue();
        });
        await page.goto(origin + "/demo.html");
        assert.equal(await page.locator("#connectionList").getAttribute("aria-busy"), "true");
        assert.equal(await page.locator("#refreshConnections").isDisabled(), true);
        release();
        await page.locator("#connectionList li").nth(4).waitFor();
        assert.equal(await page.locator("#connectionList li").count(), 5);
        assert.match(await page.locator("#connectionList").innerText(), /Not connected/);
        assert.equal(await page.locator(".demo-steps li").count(), 5);
        await page.screenshot({ path: "test-results/demo-guide-desktop.png", fullPage: true });
        await page.unroute("**/api/integrations/status");
        await page.route("**/api/integrations/status", (route) =>
            route.fulfill({ status: 503, body: "Unavailable" }),
        );
        await page.locator("#refreshConnections").click();
        await page.waitForFunction(() =>
            document.getElementById("connectionMessage").textContent.includes("could not report"),
        );
        assert.equal(await page.locator("#refreshConnections").isEnabled(), true);
        await page.unroute("**/api/integrations/status");
        await page.route("**/api/integrations/status", (route) =>
            route.fulfill({ contentType: "application/json", body: '{"services":[]}' }),
        );
        await page.locator("#refreshConnections").click();
        await page.waitForFunction(() =>
            document
                .getElementById("connectionMessage")
                .textContent.includes("No connection information"),
        );
        await page.unroute("**/api/integrations/status");
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await page.goto(origin + "/demo.html");
            await page.locator("#connectionList li").nth(4).waitFor();
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                false,
                `Guide overflow at ${width}`,
            );
            await page.screenshot({ path: `test-results/demo-guide-${width}.png`, fullPage: true });
            await page.goto(origin + "/dashboard.html");
            await page.locator('a[href="demo.html"]').waitFor();
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                false,
                `Dashboard overflow at ${width}`,
            );
        }
        await page.goto(origin + "/login.html");
        const popupPromise = page.waitForEvent("popup");
        await page.locator('a[href="demo.html"]').click();
        const popup = await popupPromise;
        await popup.waitForLoadState();
        assert.match(popup.url(), /demo\.html$/);
        assert.match(page.url(), /login\.html$/);
        assert.equal(await popup.evaluate(() => window.opener === null), true);
        assert.deepEqual(errors, []);
        console.log(
            "Hackathon guide: loading, server error, empty status, retry, links and 390/320px layout passed.",
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
