/* Integrated cohesion checks use disposable identities and in-memory storage. */
const assert = require("node:assert/strict");
const { launchBrowser } = require("./helpers.cjs");
const { createPlannerServer } = require("../server-fixture");
const catalogue = require("../../catalogue");
(async () => {
    const server = createPlannerServer({ dataFile: null });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser();
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const created = await fetch(origin + "/api/groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Aarav",
                trip: {
                    title: "Cohesion Goa",
                    city: "Goa",
                    start: "2026-10-09",
                    end: "2026-10-11",
                    budget: 5000,
                },
            }),
        });
        const group = await created.json();
        let state = group.state;
        async function command(type, payload) {
            const response = await fetch(`${origin}/api/groups/${group.code}/commands`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${group.token}`,
                },
                body: JSON.stringify({ revision: state.revision, type, payload }),
            });
            const result = await response.json();
            assert.equal(response.status, 200, result.error);
            state = result.state;
        }
        await page.goto(origin + "/dashboard.html");
        await page.evaluate((g) => {
            localStorage.setItem(
                "PlanmateUser",
                JSON.stringify({ name: "Aarav", email: "aarav@example.test" }),
            );
            localStorage.setItem(
                "planmateSessionsV1",
                JSON.stringify({
                    [g.code]: { token: g.token, memberId: g.memberId, title: "Cohesion Goa" },
                }),
            );
        }, group);
        await page.goto(`${origin}/dashboard.html?group=${group.code}`);
        await page.getByRole("heading", { name: "Cohesion Goa" }).waitFor();
        assert.equal(await page.locator("#tripDateLabel").innerText(), "PROPOSED TRIP DATES");
        assert.equal(await page.locator("#planningBadge").innerText(), "Choosing a date");
        assert.deepEqual(
            await page
                .locator("#sideNav button")
                .evaluateAll((items) => items.map((x) => x.dataset.view)),
            [
                "group",
                "discover",
                "ideas",
                "fit",
                "itinerary",
                "today",
                "expenses",
                "scrapbook",
                "saved",
            ],
        );
        await page.locator("#planningProgress button").click();
        await page.getByRole("heading", { name: "When can we go?" }).waitFor();
        assert.equal(await page.locator(".view-tabs").isVisible(), false);
        assert.equal(await page.locator("#workspace").getAttribute("role"), "region");
        assert.equal(
            await page.getByRole("button", { name: "Confirm this plan explicitly" }).count(),
            0,
        );
        await command("addAvailability", {
            id: "window",
            date: "2026-10-09",
            start: "09:00",
            end: "21:00",
        });
        await command("respondAvailability", { options: ["window"] });
        await command("chooseAvailability", { id: "window", endDate: "2026-10-11" });
        for (let i = 0; i < 2; i++) {
            await command("propose", { id: `p${i}`, place: catalogue.places[i] });
            await command("schedule", {
                id: `s${i}`,
                proposalId: `p${i}`,
                date: i ? "2026-10-10" : "2026-10-09",
                start: "10:00",
                end: "11:00",
                travel: 0,
                cost: i ? 0 : 100.25,
                costKnown: !i,
            });
        }
        await command("savePreferences", {
            interests: ["Beach"],
            pace: "balanced",
            budgetPaise: 5000,
            mustHave: "",
        });
        await page.reload();
        await page.getByRole("heading", { name: "Cohesion Goa" }).waitFor();
        await page.getByRole("heading", { name: "When can we go?" }).waitFor();
        assert.equal(await page.locator("#tripDateLabel").innerText(), "CHOSEN TRIP DATES");
        await page.getByRole("button", { name: "Confirm this plan explicitly" }).click();
        await page.locator("#appDialog .constraint-warning").first().waitFor();
        assert.match(await page.locator("#appDialog").innerText(), /budget/i);
        assert.match(await page.locator("#appDialog").innerText(), /Still unanswered: Aarav/);
        await page.locator("#appDialog").press("Escape");
        await page.locator('#sideNav [data-view="itinerary"]').click();
        assert.equal(await page.locator(".view-tabs").isVisible(), true);
        assert.equal(
            await page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-view"),
            "itinerary",
        );
        await page.locator("#mapDay").selectOption("2026-10-10");
        assert.equal(
            await page.locator('[data-day="2026-10-10"]').getAttribute("aria-pressed"),
            "true",
        );
        assert.equal(new URL(page.url()).searchParams.get("day"), "2026-10-10");
        await page.locator('[data-day="2026-10-09"]').click();
        assert.equal(await page.locator("#mapDay").inputValue(), "2026-10-09");
        await page.locator('[data-day="2026-10-10"]').click();
        await page.locator("#profileLink").click();
        await page.locator('#profileForm[aria-busy="false"]').waitFor();
        assert.equal(
            new URL(
                await page.locator("#backToPlan").getAttribute("href"),
                origin,
            ).searchParams.get("day"),
            "2026-10-10",
        );
        await page.locator("#backToPlan").click();
        await page.getByRole("heading", { name: "Cohesion Goa" }).waitFor();
        await page.locator("#mapDay").waitFor();
        assert.equal(await page.locator("#mapDay").inputValue(), "2026-10-10");
        assert.equal(await page.locator("#sideNav .active").getAttribute("data-view"), "itinerary");
        assert.match(await page.locator("#itineraryAside").innerText(), /before unknown costs/);
        assert.match(await page.locator("#itineraryAside").innerText(), /100.25/);
        const profileTab = await context.newPage();
        await profileTab.goto(
            origin + "/" + (await page.locator("#profileLink").getAttribute("href")),
        );
        await profileTab.locator("#displayName").fill("Aarav S.");
        await profileTab.locator("#saveProfile").click();
        await page.waitForFunction(
            () => document.getElementById("profileName").textContent === "Aarav S.",
        );
        await profileTab.close();
        await page.locator("#planHomeLink").click();
        await page.getByRole("heading", { name: "Cohesion Goa" }).waitFor();
        await page.locator("#mapDay").waitFor();
        assert.equal(await page.locator("#mapDay").inputValue(), "2026-10-10");
        assert.equal(new URL(page.url()).searchParams.get("group"), group.code);
        await page.locator('#sideNav [data-view="today"]').click();
        await page.locator("#todayDay").selectOption("2026-10-10");
        await page.locator("#profileLink").click();
        await page.locator("#backToPlan").click();
        await page.getByRole("heading", { name: "Cohesion Goa" }).waitFor();
        assert.equal(await page.locator("#todayDay").inputValue(), "2026-10-10");
        await page.locator("#todayDay").selectOption("");
        assert.equal(
            new URL(
                await page.locator("#profileLink").getAttribute("href"),
                origin,
            ).searchParams.has("day"),
            false,
        );
        const fresh = await fetch(`${origin}/api/groups/${group.code}`, {
            headers: { Authorization: `Bearer ${group.token}` },
        });
        state = (await fresh.json()).state;
        await command("pinStop", { id: "s0", pinned: true });
        const joined = await fetch(`${origin}/api/groups/${group.code}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Riya", invite: group.invite }),
        });
        const friend = await joined.json();
        const friendContext = await browser.newContext();
        const friendPage = await friendContext.newPage();
        await friendPage.goto(origin + "/dashboard.html");
        await friendPage.evaluate(
            (g) =>
                localStorage.setItem(
                    "planmateSessionsV1",
                    JSON.stringify({
                        [g.code]: { token: g.token, memberId: g.memberId, title: "Cohesion Goa" },
                    }),
                ),
            friend,
        );
        await friendPage.goto(`${origin}/dashboard.html?group=${group.code}&view=itinerary`);
        await friendPage.getByRole("heading", { name: "Cohesion Goa" }).waitFor();
        await friendPage.locator(".stop-card").first().waitFor();
        assert.equal(await friendPage.locator("#editTripButton").isVisible(), false);
        assert.equal(
            await friendPage
                .locator('[data-action="edit-stop"][data-id="s0"]')
                .first()
                .isDisabled(),
            true,
        );
        await friendContext.close();
        await page.locator('#sideNav [data-view="group"]').click();
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: "test-results/cohesion-desktop.png" });
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            for (const view of [
                "group",
                "discover",
                "ideas",
                "fit",
                "itinerary",
                "today",
                "expenses",
                "scrapbook",
                "saved",
            ]) {
                await page.locator("#mobileView").selectOption(view);
                assert.equal(
                    await page
                        .locator(`#sideNav [data-view="${view}"]`)
                        .getAttribute("aria-current"),
                    "page",
                );
                assert.ok(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                    `Overflow at ${width}: ${view}`,
                );
                if (!["discover", "ideas", "itinerary"].includes(view))
                    assert.equal(await page.locator(".view-tabs").isVisible(), false);
            }
        }
        await page.locator('#sideNav [data-view="group"]').click();
        await page.screenshot({ path: "test-results/cohesion-mobile.png", fullPage: true });
        assert.deepEqual(errors, []);
        console.log(
            "PASS: coherent nav order, truthful stages/dates, actionable progress, tab accessibility, confirmation conflicts, profile and brand context, live profile identity, map/day sync, permissions, complete mobile views at 390/320px",
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
