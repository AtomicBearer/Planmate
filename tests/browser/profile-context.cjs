/* Isolated profile entry and return-navigation verification. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { launchBrowser } = require("./helpers.cjs");
const { createPlannerServer } = require("../server-fixture");

(async () => {
    const server = createPlannerServer({ dataFile: null });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser();
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${origin}/login.html?space=local-trip&view=itinerary&day=2026-10-08`);
        await page.locator("#fullName").fill("Maya Planner");
        await page.locator("#email").fill("maya@example.test");
        assert.equal(await page.locator('[type="password"], #rememberMe, a[href="#"]').count(), 0);
        assert.match(
            await page.locator(".device-note").innerText(),
            /These details stay on this device/,
        );
        await page.screenshot({
            path: path.join("test-results", "login-audit-desktop.png"),
            fullPage: true,
        });
        await page.route("**/dashboard.html?*", (route) =>
            route.fulfill({ contentType: "text/html", body: "<p>Return captured</p>" }),
        );
        await page.locator("#continueButton").click();
        await page.waitForURL("**/dashboard.html?space=local-trip&view=itinerary&day=2026-10-08");
        assert.equal(
            await page.evaluate(() => JSON.parse(localStorage.getItem("PlanmateUser")).loginMethod),
            "local-profile",
        );
        let finishAccountLookup;
        const accountLookup = new Promise((resolve) => {
            finishAccountLookup = resolve;
        });
        await page.route("**/api/auth/session", async (route) => {
            await accountLookup;
            await route.continue();
        });
        await page.goto(`${origin}/profile.html?space=local-trip&view=itinerary&day=2026-10-08`);
        assert.equal(await page.locator("#profileForm").getAttribute("aria-busy"), "true");
        assert.equal(await page.locator("#profileForm").getAttribute("inert"), "");
        assert.equal(
            await page.locator("#backToPlan").getAttribute("href"),
            "dashboard.html?space=local-trip&view=itinerary&day=2026-10-08",
        );
        assert.equal(
            await page.locator("#profileBrand").getAttribute("href"),
            await page.locator("#backToPlan").getAttribute("href"),
        );
        finishAccountLookup();
        await page.locator('#profileForm[aria-busy="false"]').waitFor();
        await page.unroute("**/api/auth/session");
        await page.locator("#wishCity").fill("Jaipur");
        await page.locator("#addWish").click();
        await page.locator("[data-plan-wish]").click();
        await page.waitForURL(
            "**/dashboard.html?space=local-trip&view=itinerary&day=2026-10-08&planCity=Jaipur",
        );
        await page.goto(
            `${origin}/profile.html?group=abcdefghijklmnop&space=local-trip&view=today&day=2026-02-31&next=https://example.test`,
        );
        assert.equal(
            await page.locator("#backToPlan").getAttribute("href"),
            "dashboard.html?group=abcdefghijklmnop&view=today",
        );
        await page.setViewportSize({ width: 320, height: 740 });
        await page.goto(`${origin}/login.html`);
        await page.screenshot({
            path: path.join("test-results", "login-audit-mobile.png"),
            fullPage: true,
        });
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
        );
        assert.deepEqual(errors, []);
        console.log(
            "PASS: device profile entry, clear storage scope, working login controls, preserved profile return context, wishlist query composition, rejected malformed context, and 320px login layout.",
        );
        await context.close();
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
