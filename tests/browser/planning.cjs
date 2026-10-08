const assert = require("node:assert/strict");
const { launchBrowser } = require("./helpers.cjs");
const { createPlannerServer } = require("../server-fixture");
(async () => {
    const server = createPlannerServer({ dataFile: null });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser();
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const response = await fetch(base + "/api/groups", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                trip: {
                    title: "Test Goa",
                    city: "Goa",
                    start: "2026-10-09",
                    end: "2026-10-11",
                    budget: 5000,
                },
                name: "Aarav",
            }),
        });
        const g = await response.json();
        await page.goto(base + "/dashboard.html");
        await page.evaluate(
            (g) =>
                localStorage.setItem(
                    "planmateSessionsV1",
                    JSON.stringify({
                        [g.code]: { token: g.token, memberId: g.memberId, title: "Test Goa" },
                    }),
                ),
            g,
        );
        await page.goto(base + "/dashboard.html?group=" + g.code);
        await page.getByRole("button", { name: "Dates & attendance" }).click();
        await page.locator('[data-plan-form="add-date"] [name=date]').fill("2026-10-09");
        await page.getByRole("button", { name: "Add a date option" }).click();
        await page.locator('[data-plan-form="availability"] input').check();
        await page.getByRole("button", { name: "Update my availability" }).click();
        await page.getByRole("button", { name: "Choose final date" }).click();
        await page.getByRole("button", { name: "Set final date" }).click();
        await page.waitForSelector("#appDialog:not([open])", { state: "attached" });
        await page.getByRole("button", { name: "I'm in", exact: true }).click();
        await page.getByText("Confirmed: Aarav", { exact: true }).waitFor();
        await page.locator('#sideNav [data-view="fit"]').click();
        await page.getByRole("button", { name: "Copy interests & pace from my profile" }).click();
        await page
            .locator('[data-plan-form="preferences"] [name="interests"][value="Beach"]')
            .check();
        await page.locator('[data-plan-form="preferences"] [name="budget"]').fill("5000");
        await page.getByRole("button", { name: "Share my trip preferences" }).click();
        await page.getByRole("button", { name: "Generate up to three drafts" }).click();
        await page.getByRole("button", { name: "I prefer this draft" }).first().click();
        await page.getByRole("button", { name: "Review & apply explicitly" }).first().click();
        await page.locator('[name="acknowledge"]').check();
        await page.getByRole("button", { name: "Replace itinerary with this draft" }).click();
        await page.locator(".stop-card").first().waitFor();
        await page.getByRole("button", { name: "Move down", exact: true }).first().click();
        await page.getByRole("button", { name: "Apply this order" }).click();
        await page.getByRole("button", { name: "Undo last reorder" }).click();
        await page.getByRole("button", { name: "Set sourced location" }).first().click();
        await page.locator('[name="latitude"]').fill("15.55");
        await page.locator('[name="longitude"]').fill("73.75");
        await page.locator('[name="source"]').fill("https://example.com/test-location");
        await page.getByRole("button", { name: "Save location" }).click();
        await page.locator(".map-marker").first().click();
        await page.locator(".selected-stop").waitFor();
        await page.getByRole("button", { name: "Mark group visited", exact: true }).first().click();
        await page.locator('#sideNav [data-view="ideas"]').click();
        await page.locator(".suggestion-discussion summary").first().click();
        await page
            .locator('[data-outing-form="comment"] textarea')
            .first()
            .fill("<b>Meet near the gate</b>");
        await page.getByRole("button", { name: "Post comment" }).first().click();
        assert.equal(await page.locator(".suggestion-discussion").first().getAttribute("open"), "");
        await page.getByText("<b>Meet near the gate</b>", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Edit", exact: true }).first().click();
        await page.locator('[data-outing-form="edit-comment"] textarea').fill("Meet at 9");
        await page.getByRole("button", { name: "Save comment" }).click();
        await page.locator('#sideNav [data-view="today"]').click();
        await page.locator("#todayDay").selectOption("2026-10-09");
        await page.locator(".today-card").first().waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: "test-results/today-mobile.png", fullPage: true });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('#sideNav [data-view="expenses"]').click();
        await page.getByRole("button", { name: "Add actual expense" }).click();
        await page.locator('[name="description"]').fill("Lunch bill");
        await page.locator('[name="amount"]').fill("100.01");
        await page.getByRole("button", { name: "Save actual expense" }).click();
        await page.getByText("Lunch bill", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Edit expense" }).click();
        await page.locator('[name="split"]').selectOption("custom");
        await page.locator(".share-input").first().fill("90");
        await page.getByRole("button", { name: "Save actual expense" }).click();
        await page.getByText("Custom shares must equal the expense total exactly.").waitFor();
        await page.locator(".share-input").first().fill("100.01");
        await page.getByRole("button", { name: "Save actual expense" }).click();
        await page.locator('#sideNav [data-view="scrapbook"]').click();
        await page.getByRole("button", { name: "Add my photo & caption" }).first().click();
        await page.locator('[name="photo"]').setInputFiles({
            name: "own-memory.png",
            mimeType: "image/png",
            buffer: Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
                "base64",
            ),
        });
        await page.locator('[name="caption"]').fill("Our <lovely> stop");
        await page.locator('[name="own"]').check();
        await page.getByRole("button", { name: "Upload to our scrapbook" }).click();
        await page.locator(".scrapbook-photo img").waitFor();
        await page.getByText("Our <lovely> stop", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Edit caption" }).click();
        await page.locator('[name="caption"]').fill("Good times");
        await page.getByRole("button", { name: "Save caption" }).click();
        await page.getByText("Good times", { exact: true }).waitFor();
        await page.reload();
        await page.locator('#sideNav [data-view="scrapbook"]').click();
        await page.getByText("Good times", { exact: true }).waitFor();
        await page.locator(".scrapbook-photo img").waitFor();
        await page.getByRole("button", { name: "Delete my photo" }).click();
        await page.getByRole("button", { name: "Delete my uploaded photo" }).click();
        await page.getByText("No photo yet. The visit is still part of your story.").waitFor();
        await page.setViewportSize({ width: 320, height: 740 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: "test-results/scrapbook-mobile.png", fullPage: true });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('#sideNav [data-view="itinerary"]').click();
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export PDF", exact: true }).click();
        const pdf = await downloadPromise;
        assert.ok(pdf.suggestedFilename().endsWith(".pdf"));
        await page.getByRole("button", { name: "Export PDF", exact: true }).waitFor();
        await page.getByText("Our day, on the map", { exact: true }).waitFor();
        await page.locator('#sideNav [data-view="fit"]').click();
        await page.locator('[name="mustHave"]').fill("Keep this unsaved preference");
        const joinedResponse = await fetch(`${base}/api/groups/${g.code}/join`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Riya", invite: g.invite }),
        });
        const friend = await joinedResponse.json();
        await page.waitForTimeout(4500);
        assert.equal(
            await page.locator('[name="mustHave"]').inputValue(),
            "Keep this unsaved preference",
        );
        const friendContext = await browser.newContext();
        const friendPage = await friendContext.newPage();
        await friendPage.goto(base + "/dashboard.html");
        await friendPage.evaluate(
            (g) =>
                localStorage.setItem(
                    "planmateSessionsV1",
                    JSON.stringify({
                        [g.code]: { token: g.token, memberId: g.memberId, title: "Test Goa" },
                    }),
                ),
            friend,
        );
        await friendPage.goto(base + "/dashboard.html?group=" + g.code);
        await friendPage.getByRole("button", { name: "Dates & attendance" }).click();
        assert.equal(
            await friendPage.getByRole("button", { name: "Add a date option" }).count(),
            0,
        );
        await friendPage.getByRole("button", { name: "Maybe", exact: true }).first().click();
        await friendPage.getByText("Tentative: Riya", { exact: true }).waitFor();
        await friendContext.close();
        await page.locator('#sideNav [data-view="itinerary"]').click();
        await page.route("**/api/groups/*/map?*", async (route) => {
            await new Promise((r) => setTimeout(r, 500));
            await route.continue();
        });
        await page.getByRole("button", { name: "Refresh locations & map" }).click();
        await page.locator('#sideNav [data-view="fit"]').click();
        await page.waitForTimeout(1000);
        await page.getByText("A plan with room for everyone", { exact: true }).waitFor();
        await page.unroute("**/api/groups/*/map?*");
        await page.locator('#sideNav [data-view="group"]').click();
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: "test-results/planning-desktop.png" });
        assert.deepEqual(errors, []);
        await page.screenshot({ path: "test-results/agreement.png", fullPage: true });
        console.log(
            "PASS: all four phases: agreement, preferences, explicit drafts, reorder/undo, map, comments, mobile Today, expense validation, private photo upload/edit/reload/delete",
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
