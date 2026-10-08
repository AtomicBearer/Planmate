const assert = require("node:assert/strict");
const { launchBrowser } = require("./helpers.cjs");
const { createPlannerServer } = require("../server-fixture");
const catalogue = require("../../catalogue");
(async () => {
    const server = createPlannerServer({ dataFile: null });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser();
    try {
        const ctx = await browser.newContext(),
            page = await ctx.newPage(),
            errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const g = await (
            await fetch(base + "/api/groups", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    name: "Draft Host",
                    trip: {
                        title: "Draft Fixture",
                        city: "Goa",
                        start: "2026-10-09",
                        end: "2026-10-11",
                        budget: 5000,
                    },
                }),
            })
        ).json();
        async function current() {
            return (
                await (
                    await fetch(base + "/api/groups/" + g.code, {
                        headers: { Authorization: "Bearer " + g.token },
                    })
                ).json()
            ).state;
        }
        async function command(type, payload) {
            const s = await current();
            const r = await fetch(base + "/api/groups/" + g.code + "/commands", {
                method: "POST",
                headers: { "content-type": "application/json", Authorization: "Bearer " + g.token },
                body: JSON.stringify({ type, payload, revision: s.revision }),
            });
            assert.ok(r.ok, await r.text());
        }
        for (let i = 0; i < 2; i++)
            await command("propose", { id: "p" + i, place: catalogue.places[i] });
        await page.goto(base + "/dashboard.html");
        await page.evaluate(
            (g) =>
                localStorage.setItem(
                    "planmateSessionsV1",
                    JSON.stringify({
                        [g.code]: { token: g.token, memberId: g.memberId, title: "Draft Fixture" },
                    }),
                ),
            g,
        );
        await page.goto(base + "/dashboard.html?group=" + g.code + "&view=fit");
        await page.getByRole("heading", { name: "Draft Fixture" }).waitFor();
        await page.locator("[name=mustHave]").fill("My blurred beach preference");
        await page.locator("[name=mustHave]").evaluate((el) => el.blur());
        await fetch(base + "/api/groups/" + g.code + "/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Friend", invite: g.invite }),
        });
        await page.waitForTimeout(4500);
        assert.equal(
            await page.locator("[name=mustHave]").inputValue(),
            "My blurred beach preference",
        );
        await page.locator("[name=mustHave]").focus();
        await page.locator("[name=mustHave]").evaluate((el) => el.setSelectionRange(5, 5));
        await command("updateMember", { name: "Focused refresh" });
        await page.waitForTimeout(4500);
        assert.equal(
            await page
                .locator("[name=mustHave]")
                .evaluate((el) => el === document.activeElement && el.selectionStart === 5),
            true,
        );
        await page.locator("#sideNav [data-view=ideas]").click();
        for (let i = 0; i < 2; i++) {
            await page.locator(".suggestion-discussion summary").nth(i).click();
            await page
                .locator("[data-outing-form=comment] textarea")
                .nth(i)
                .fill("Unfinished comment " + i);
        }
        await page
            .locator("[data-outing-form=comment] textarea")
            .last()
            .evaluate((el) => el.blur());
        await command("updateMember", { name: "Draft Host renamed" });
        await page.waitForTimeout(4500);
        for (let i = 0; i < 2; i++)
            assert.equal(
                await page.locator("[data-outing-form=comment] textarea").nth(i).inputValue(),
                "Unfinished comment " + i,
            );
        await page.reload();
        await page.getByRole("heading", { name: "Draft Fixture" }).waitFor();
        assert.equal(
            await page.locator("[data-outing-form=comment] textarea").first().inputValue(),
            "",
        );
        async function restore(kind, id = "") {
            await page.evaluate(
                ({ kind, id }) => {
                    const button = [
                        ...document.querySelectorAll("[data-draft-action=restore]"),
                    ].find((b) => {
                        const key = JSON.parse(b.dataset.key);
                        return key[2] === kind && key[3] === id;
                    });
                    if (!button) throw new Error("Draft recovery not found");
                    button.click();
                },
                { kind, id },
            );
        }
        await restore("comment", "p0");
        assert.equal(
            await page.locator("[data-outing-form=comment] textarea").first().inputValue(),
            "Unfinished comment 0",
        );
        await restore("comment", "p1");
        assert.equal(
            await page.locator("[data-outing-form=comment] textarea").nth(1).inputValue(),
            "Unfinished comment 1",
        );
        await restore("preferences");
        assert.equal(
            await page.locator("[name=mustHave]").inputValue(),
            "My blurred beach preference",
        );
        await command("savePreferences", {
            interests: ["Beach"],
            pace: "balanced",
            budgetPaise: null,
            mustHave: "Other-device preference",
        });
        await page.waitForTimeout(4500);
        await page.getByRole("button", { name: "Share my trip preferences", exact: true }).click();
        assert.equal((await current()).preferences[g.memberId].mustHave, "Other-device preference");
        await page
            .getByRole("button", { name: "I reviewed the changes — keep my draft", exact: true })
            .click();
        await page.getByRole("button", { name: "Share my trip preferences", exact: true }).click();
        await page.waitForFunction(
            () =>
                !Object.values(
                    JSON.parse(localStorage.getItem("planmateFormDraftsV1") || "{}"),
                ).some((r) => r.kind === "preferences"),
        );
        assert.equal(
            (await current()).preferences[g.memberId].mustHave,
            "My blurred beach preference",
        );
        await page.locator("[name=mustHave]").fill("Keep during failed request");
        await page.route("**/commands", (route) => route.abort());
        await page.getByRole("button", { name: "Share my trip preferences", exact: true }).click();
        assert.equal(
            await page.locator("[name=mustHave]").inputValue(),
            "Keep during failed request",
        );
        await page.unroute("**/commands");
        let intercepted = false;
        await page.route("**/commands", async (route) => {
            if (!intercepted) {
                intercepted = true;
                await command("updateMember", { name: "Concurrent rename" });
            }
            await route.continue();
        });
        await page.getByRole("button", { name: "Share my trip preferences", exact: true }).click();
        await page
            .getByRole("button", { name: "I reviewed the changes — keep my draft", exact: true })
            .waitFor();
        assert.equal(
            await page.locator("[name=mustHave]").inputValue(),
            "Keep during failed request",
        );
        await page.unroute("**/commands");
        await page.getByRole("button", { name: "Discard unfinished changes", exact: true }).click();
        assert.equal(
            await page.locator("[name=mustHave]").inputValue(),
            "My blurred beach preference",
        );
        await page.locator("#sideNav [data-view=ideas]").click();
        await page.locator(".suggestion-discussion summary").first().click();
        await page
            .locator("[data-outing-form=comment]")
            .first()
            .getByRole("button", { name: "I reviewed the changes — keep my draft", exact: true })
            .click();
        await page.getByRole("button", { name: "Post comment", exact: true }).first().click();
        await page.waitForFunction(
            () =>
                !Object.values(
                    JSON.parse(localStorage.getItem("planmateFormDraftsV1") || "{}"),
                ).some((r) => r.kind === "comment" && r.id === "p0"),
        );
        assert.equal(
            await page.locator("[data-outing-form=comment] textarea").first().inputValue(),
            "",
        );
        await command("removeIdea", { id: "p1" });
        await page.waitForTimeout(4500);
        await page
            .getByText("comment · original item or membership is unavailable", { exact: true })
            .waitFor();
        assert.deepEqual(errors, []);
        console.log(
            "PASS drafts: blurred/focused multi-form refresh, reload Restore, changed-source review, request failure, stale revision, success cleanup, discard and missing item",
        );
        await ctx.close();
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
