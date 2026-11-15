"use strict";
const assert = require("node:assert/strict"),
    { launchBrowser } = require("./helpers.cjs"),
    { createPlannerServer } = require("../server-fixture"),
    Core = require("../../shared/planner-core");
(async () => {
    const server = createPlannerServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`,
        browser = await launchBrowser();
    try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            reducedMotion: "reduce",
        });
        const page = await context.newPage(),
            errors = [],
            externalRequests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
            if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
        });
        await page.goto(origin + "/");
        await page.evaluate(async () => {
            await window.PlanmateAccount.ready;
            await document.fonts.ready;
        });
        assert.equal(await page.locator("#accountSignIn").isVisible(), false);
        assert.equal(
            await page.locator('script[src="https://accounts.google.com/gsi/client"]').count(),
            0,
        );
        assert.equal(await page.getByText("Weekend Hangout").count(), 0);
        assert.equal(await page.evaluate(() => document.fonts.check('16px "Patrick Hand"')), true);
        await page.screenshot({
            path: "test-results/product-login-local-fonts.png",
            fullPage: true,
        });
        await page.goto(origin + "/dashboard.html");
        await page.getByRole("heading", { name: "Your next adventure starts here" }).waitFor();
        assert.equal(await page.locator(".hero").isVisible(), false);
        assert.equal(await page.locator(".trip-strip").isVisible(), false);
        assert.equal(await page.locator("#itineraryAside").isVisible(), false);
        assert.equal(await page.locator('a[href="demo.html"], #previewMember').count(), 0);
        assert.deepEqual(
            await page.evaluate(() =>
                Object.keys(JSON.parse(localStorage.getItem("planmateSpacesV1") || "{}")),
            ),
            [],
        );
        assert.equal((await page.locator(".place-card").count()) > 0, true);
        await page.screenshot({ path: "test-results/product-start-desktop.png", fullPage: true });
        for (const view of [
            "group",
            "fit",
            "ideas",
            "itinerary",
            "today",
            "expenses",
            "scrapbook",
        ]) {
            await page.locator(`#sideNav [data-view="${view}"]`).click();
            await page.getByRole("heading", { name: "Choose a trip to get started" }).waitFor();
        }
        await page.locator('#entryGuide [data-action="new-trip"]').click();
        const form = page.locator('[data-form="new-trip"]');
        assert.equal(await form.locator('[name="title"]').inputValue(), "");
        assert.equal(await form.locator('[name="budget"]').inputValue(), "");
        await form.locator('[name="title"]').fill("Pune with friends");
        await form.locator('[name="city"]').fill("Pune");
        await form.locator('[name="start"]').fill("2026-10-10");
        await form.locator('[name="end"]').fill("2026-10-11");
        await form.locator('[name="budget"]').fill("3000");
        await form.locator('[name="name"]').fill("Mira");
        await form.locator('[name="shared"]').uncheck();
        await form.getByRole("button", { name: "Create planning space" }).click();
        await page.getByRole("heading", { name: "Pune with friends" }).waitFor();
        assert.equal(await page.locator("#entryGuide").isVisible(), false);
        const spaces = await page.evaluate(() =>
            JSON.parse(localStorage.getItem("planmateSpacesV1")),
        );
        assert.equal(Object.keys(spaces).length, 1);
        const personal = Object.values(spaces)[0];
        assert.equal(personal.state.members.length, 1);
        assert.equal(personal.state.members[0].name, "Mira");
        assert.deepEqual(personal.state.stops, []);
        assert.deepEqual(personal.state.proposals, []);
        assert.equal(await page.locator("#profileName").innerText(), "Mira");
        await page.reload();
        await page.getByRole("heading", { name: "Pune with friends" }).waitFor();
        await page.locator('#sideNav [data-view="itinerary"]').click();
        await page.screenshot({ path: "test-results/product-trip-desktop.png", fullPage: true });
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                false,
                `Trip overflow at ${width}`,
            );
            await page.screenshot({
                path: `test-results/product-trip-${width}.png`,
                fullPage: true,
            });
        }
        const recovered = {
            state: Core.createState(
                {
                    title: "Recovered Jaipur trip",
                    city: "Jaipur",
                    start: "2026-10-10",
                    end: "2026-10-11",
                    budget: 2000,
                },
                { id: "owner", name: "Mira" },
            ),
            memberId: "owner",
        };
        const legacy = { ...structuredClone(recovered), preview: true };
        legacy.state.trip.title = "Earlier saved trip";
        await page.evaluate(
            ({ recovered, legacy }) => {
                localStorage.setItem(
                    "planmateSpacesV1",
                    JSON.stringify({ preview: legacy, recovered }),
                );
                localStorage.setItem("planmateActiveSpaceV1", JSON.stringify("preview"));
            },
            { recovered, legacy },
        );
        await page.goto(origin + "/dashboard.html");
        await page.getByRole("heading", { name: "Recovered Jaipur trip" }).waitFor();
        assert.equal(await page.locator("#entryGuide").isVisible(), false);
        assert.deepEqual(
            await page.evaluate(() => JSON.parse(localStorage.getItem("planmateSpacesV1")).preview),
            legacy,
        );
        await page.getByRole("button", { name: "My trips", exact: true }).click();
        await page.getByRole("button", { name: "Earlier saved trip", exact: true }).click();
        await page.getByRole("heading", { name: "Earlier saved trip", exact: true }).waitFor();
        assert.deepEqual(
            await page.evaluate(
                () => JSON.parse(localStorage.getItem("planmateSpacesV1")).preview.state,
            ),
            legacy.state,
        );
        await page.reload();
        await page.getByRole("heading", { name: "Earlier saved trip", exact: true }).waitFor();
        for (const route of ["/demo.html", "/css/demo.css", "/js/demo.js", "/demo.js"])
            assert.equal((await fetch(origin + route)).status, 404);
        const fresh = await browser.newContext({
            viewport: { width: 320, height: 844 },
            reducedMotion: "reduce",
        });
        const mobile = await fresh.newPage();
        await mobile.goto(origin + "/");
        await mobile.evaluate(() => document.fonts.ready);
        assert.equal(
            await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
        );
        await mobile.screenshot({ path: "test-results/product-login-320.png", fullPage: true });
        await mobile.goto(origin + "/dashboard.html");
        await mobile.getByRole("heading", { name: "Your next adventure starts here" }).waitFor();
        assert.equal(
            await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
        );
        await mobile.screenshot({ path: "test-results/product-start-320.png", fullPage: true });
        await fresh.close();
        assert.deepEqual(errors, []);
        assert.deepEqual(externalRequests, []);
        // Optional verified sign-in still works when deliberately configured.
        // Intercept the SDK; this verifies loading/error behavior without Google calls.
        const accounts = await browser.newContext();
        let required = false;
        await accounts.route("**/api/auth/config", (route) =>
            route.fulfill({
                json: {
                    configured: true,
                    required,
                    mode: required ? "required" : "guest",
                    clientId: "123-fixture.apps.googleusercontent.com",
                },
            }),
        );
        await accounts.route("**/api/auth/challenge", (route) =>
            route.fulfill({ json: { nonce: "test-nonce" } }),
        );
        await accounts.route("https://accounts.google.com/gsi/client", (route) =>
            route.fulfill({
                contentType: "text/javascript",
                body: "window.google={accounts:{id:{initialize(c){window.testNonce=c.nonce},renderButton(node){node.textContent='Configured sign-in button'}}}};",
            }),
        );
        const providerPage = await accounts.newPage();
        providerPage.on("pageerror", (error) => errors.push(error.message));
        await providerPage.goto(origin + "/");
        await providerPage.getByText("Configured sign-in button").waitFor();
        assert.equal(await providerPage.locator("#accountSignIn").isVisible(), true);
        assert.equal(await providerPage.evaluate(() => window.testNonce), "test-nonce");
        required = true;
        await providerPage.route("https://accounts.google.com/gsi/client", (route) =>
            route.abort(),
        );
        await providerPage.reload();
        await providerPage
            .getByText("Google sign-in could not load. Reconnect and reload.")
            .waitFor();
        assert.equal(await providerPage.locator("#loginForm").isVisible(), false);
        assert.deepEqual(errors, []);
        await accounts.close();
        console.log(
            "PASS product: empty start, guest creation/reload, saved-plan compatibility, local fonts/no external requests, optional sign-in loading/error states and 390/320px layouts.",
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
