"use strict";
const assert = require("node:assert/strict"),
    { launchBrowser } = require("./helpers.cjs"),
    { createPlannerServer } = require("../server-fixture"),
    catalogue = require("../../catalogue");
(async () => {
    const server = createPlannerServer({
        dataFile: null,
        discoveryOptions: { env: {} },
        mapOptions: { env: {} },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`,
        browser = await launchBrowser();
    try {
        const response = await fetch(base + "/api/groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Night Host",
                trip: {
                    title: "Night fixture",
                    city: "Goa",
                    start: "2026-10-09",
                    end: "2026-10-10",
                    budget: 5000,
                    timezone: "Asia/Kolkata",
                },
            }),
        });
        const group = await response.json();
        let state = group.state;
        async function command(type, payload) {
            const r = await fetch(`${base}/api/groups/${group.code}/commands`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${group.token}`,
                },
                body: JSON.stringify({ revision: state.revision, type, payload }),
            });
            const result = await r.json();
            assert.equal(r.status, 200, result.error);
            state = result.state;
        }
        await command("propose", {
            id: "night-event",
            place: {
                ...catalogue.places[0],
                id: "night-event",
                name: "Published event fixture",
                category: "Event",
                eventDate: "2026-10-09",
                eventEndDate: "2026-10-09",
                eventTime: "23:00",
                duration: 120,
            },
        });
        await command("estimateSuggestion", { id: "night-event", costPaise: 10000, travel: 30 });
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            reducedMotion: "reduce",
            timezoneId: "America/Los_Angeles",
        });
        const page = await context.newPage(),
            errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(base + "/dashboard.html");
        await page.evaluate(
            (g) =>
                localStorage.setItem(
                    "planmateSessionsV1",
                    JSON.stringify({
                        [g.code]: { token: g.token, memberId: g.memberId, title: "Night fixture" },
                    }),
                ),
            group,
        );
        await page.goto(`${base}/dashboard.html?group=${group.code}&view=group`);
        await page.getByRole("heading", { name: "Night fixture", exact: true }).waitFor();
        const poll = page.locator('[data-plan-form="add-date"]');
        await poll.locator('[name="start"]').fill("22:00");
        await poll.locator('[name="end"]').fill("02:00");
        await poll.getByLabel("Ends next day", { exact: false }).check();
        await poll.getByRole("button", { name: "Add a date option" }).tap();
        await page.locator('[data-plan-form="availability"] input').check();
        await page.getByRole("button", { name: "Update my availability" }).tap();
        await page
            .getByText("Common availability: 2026-10-09 22:00–02:00 (+1 day, 2026-10-10)", {
                exact: true,
            })
            .waitFor();
        await page.getByRole("button", { name: "Choose final date" }).tap();
        assert.equal(await page.locator('[name="endDate"]').getAttribute("min"), "2026-10-10");
        await page.getByRole("button", { name: "Set final date" }).tap();
        await page.locator("#mobileView").selectOption("fit");
        const prefs = page.locator('[data-plan-form="preferences"]');
        await prefs.locator('[name="interests"][value="Event"]').check();
        await prefs.locator('[name="needs"][value="Event"]').check();
        await prefs.locator('[name="mustHave"]').fill("Published event fixture");
        await prefs.locator('[name="budget"]').fill("5000");
        await prefs.getByRole("button", { name: "Share my trip preferences" }).tap();
        await page.reload();
        await page.locator('[name="needs"][value="Event"]:checked').waitFor();
        await page.getByRole("button", { name: "Generate up to three drafts" }).tap();
        await page
            .getByText("2026-10-09 23:00–01:00 (+1 day, 2026-10-10) · Published event fixture", {
                exact: true,
            })
            .first()
            .waitFor();
        assert.equal(
            await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
            true,
        );
        await page.getByRole("button", { name: "Review & apply explicitly" }).first().tap();
        await page.locator('[name="acknowledge"]').check();
        await page.getByRole("button", { name: "Replace itinerary with this draft" }).tap();
        await page.locator(".stop-card").first().waitFor();
        await page.locator("#mobileView").selectOption("today");
        await page.locator("#todayDay").selectOption("2026-10-10");
        await page.getByText("Published event fixture", { exact: true }).first().waitFor();
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            assert.ok(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                "Today overflows at " + width,
            );
        }
        await page.screenshot({ path: "test-results/night-fit-mobile.png", fullPage: true });
        assert.deepEqual(errors, []);
        console.log(
            "PASS overnight UI: touch poll/final date, persisted required categories, fixed event draft/apply, next-day Today at 390/320px, reduced motion and different browser timezone (fixtures)",
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
