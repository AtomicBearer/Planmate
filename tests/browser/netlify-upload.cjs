"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    http = require("node:http"),
    { buildNetlify } = require("../../scripts/build-netlify"),
    { launchBrowser } = require("./helpers.cjs");
(async () => {
    const directory = buildNetlify(),
        types = {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".ttf": "font/ttf",
        },
        server = http.createServer((request, response) => {
            const url = new URL(request.url, "http://localhost"),
                file = path.resolve(
                    directory,
                    "." + (url.pathname === "/" ? "/index.html" : url.pathname),
                );
            if (
                !file.startsWith(directory + path.sep) ||
                !fs.existsSync(file) ||
                !fs.statSync(file).isFile()
            ) {
                response.writeHead(404);
                return response.end("Page not found");
            }
            response.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain" });
            response.end(fs.readFileSync(file));
        });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`,
        browser = await launchBrowser();
    try {
        const context = await browser.newContext({
                viewport: { width: 1440, height: 900 },
                reducedMotion: "reduce",
            }),
            page = await context.newPage(),
            errors = [],
            requests = [],
            missing = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => requests.push(request.url()));
        page.on("response", (response) => {
            if (response.status() >= 400) missing.push(response.url());
        });
        await page.goto(origin + "/");
        await page.evaluate(async () => {
            await window.PlanmateAccount.ready;
            await document.fonts.ready;
        });
        assert.equal(await page.locator("#accountSignIn").isVisible(), false);
        await page.locator("#fullName").fill("Mira");
        await page.locator("#email").fill("mira@example.test");
        await page.locator("#continueButton").click();
        await page.waitForURL("**/dashboard.html");
        await page.getByRole("heading", { name: "Your next adventure starts here" }).waitFor();
        assert.match(await page.locator("#accountBanner").innerText(), /saved in this browser/);
        assert.deepEqual(
            await page.evaluate(() =>
                Object.keys(JSON.parse(localStorage.getItem("planmateSpacesV1") || "{}")),
            ),
            [],
        );
        await page.screenshot({ path: "test-results/netlify-empty-desktop.png", fullPage: true });
        await page.locator('#entryGuide [data-action="new-trip"]').click();
        const form = page.locator('[data-form="new-trip"]');
        assert.equal(await form.locator('[name="shared"]').isDisabled(), true);
        await form.locator('[name="title"]').fill("My Pune visit");
        await form.locator('[name="city"]').fill("Pune");
        await form.locator('[name="start"]').fill("2026-10-10");
        await form.locator('[name="end"]').fill("2026-10-11");
        await form.locator('[name="budget"]').fill("3000");
        await form.getByRole("button", { name: "Create planning space" }).click();
        await page.getByRole("heading", { name: "My Pune visit" }).waitFor();
        await page.reload();
        await page.getByRole("heading", { name: "My Pune visit" }).waitFor();
        assert.equal(await page.locator("#profileName").innerText(), "Mira");
        await page.getByRole("button", { name: "Invite friends", exact: true }).click();
        await page.getByText("Your plans stay in this browser.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Got it", exact: true }).click();
        await page.locator('#sideNav [data-view="itinerary"]').click();
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export PDF", exact: true }).click();
        const download = await downloadPromise;
        assert.ok(download.suggestedFilename().endsWith(".pdf"));
        await page.locator("#profileLink").click();
        await page.waitForURL("**/profile.html?*");
        await page.evaluate(async () => {
            await window.PlanmateAccount.ready;
            await document.fonts.ready;
        });
        assert.equal(await page.locator("#accountSignIn").count(), 0);
        await page.goto(origin + "/dashboard.html");
        await page.getByRole("heading", { name: "My Pune visit" }).waitFor();
        await page.setViewportSize({ width: 320, height: 844 });
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
        );
        await page.screenshot({ path: "test-results/netlify-trip-320.png", fullPage: true });
        const fresh = await browser.newContext({
            viewport: { width: 390, height: 844 },
            reducedMotion: "reduce",
        });
        const freshPage = await fresh.newPage();
        await freshPage.goto(origin + "/dashboard.html");
        await freshPage.getByRole("heading", { name: "Your next adventure starts here" }).waitFor();
        assert.deepEqual(
            await freshPage.evaluate(() =>
                Object.keys(JSON.parse(localStorage.getItem("planmateSpacesV1") || "{}")),
            ),
            [],
        );
        await fresh.close();
        assert.deepEqual(errors, []);
        assert.deepEqual(missing, []);
        assert.equal(
            requests.some((url) => new URL(url).pathname.startsWith("/api/")),
            false,
        );
        assert.equal(
            requests.some((url) => new URL(url).origin !== origin),
            false,
        );
        for (const file of ["/.env", "/data/plans.sqlite", "/server/index.js"])
            assert.equal((await fetch(origin + file)).status, 404);
        console.log(
            "PASS Netlify upload: empty start, device profile/create/reload, sharing feedback, local PDF/assets, separate profile, mobile layout, no API/external requests or private files.",
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
