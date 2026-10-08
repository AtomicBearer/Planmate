const assert = require("node:assert/strict");
const { launchBrowser } = require("./helpers.cjs");
const { createPlannerServer } = require("../server-fixture");
(async () => {
    const server = createPlannerServer({
        dataFile: null,
        accountOptions: {
            env: { GOOGLE_CLIENT_ID: "fixture-client", ACCOUNT_MODE: "required" },
            verify: async (token) => JSON.parse(token),
        },
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = "http://127.0.0.1:" + server.address().port,
        browser = await launchBrowser();
    let errors = [];
    async function signed(sub) {
        const c = await browser.newContext();
        const challenge = await (await c.request.get(base + "/api/auth/challenge")).json();
        await c.request.post(base + "/api/auth/google", {
            data: {
                credential: JSON.stringify({
                    sub,
                    name: sub,
                    email: sub + "@example.test",
                    email_verified: true,
                    aud: "fixture-client",
                    iss: "accounts.google.com",
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    nonce: challenge.nonce,
                }),
            },
        });
        const p = await c.newPage();
        p.on("pageerror", (e) => errors.push(e.message));
        return { c, p };
    }
    try {
        const host = await signed("Host");
        await host.p.goto(base + "/dashboard.html");
        await host.p.getByRole("button", { name: "Create a trip", exact: true }).click();
        await host.p.locator("[name=title]").fill("Account UI trip");
        await host.p.getByRole("button", { name: "Create planning space", exact: true }).click();
        await host.p.getByRole("heading", { name: "Account UI trip", exact: true }).waitFor();
        await host.p.getByRole("button", { name: "Invite friends", exact: true }).click();
        const link = await host.p.locator(".invite-link").innerText();
        assert.ok(new URL(link).searchParams.get("invite"));
        await host.p.getByRole("button", { name: "Close dialog", exact: true }).click();
        const friend = await signed("Friend");
        await friend.p.goto(link);
        await friend.p
            .getByRole("button", { name: "Join the planning space", exact: true })
            .click();
        await friend.p.getByRole("heading", { name: "Account UI trip", exact: true }).waitFor();
        assert.match(await friend.p.locator("#accountBanner").innerText(), /Signed in as Friend/);
        await friend.p.locator("#profileLink").click();
        await friend.p.locator("#displayName").fill("Friend updated");
        await friend.p.getByRole("button", { name: "Save my profile", exact: true }).click();
        await friend.p.waitForTimeout(500);
        const other = await signed("Friend");
        await other.p.goto(base + "/profile.html");
        assert.equal(await other.p.locator("#displayName").inputValue(), "Friend updated");
        await friend.p.locator("#backToPlan").click();
        await friend.p.getByRole("heading", { name: "Account UI trip" }).waitFor();
        await host.p.reload();
        await host.p.getByRole("heading", { name: "People & permissions", exact: true }).waitFor();
        await host.p.getByRole("button", { name: "Make organizer", exact: true }).click();
        await host.p.getByRole("button", { name: "Transfer organizer role", exact: true }).click();
        await host.p.waitForTimeout(500);
        await friend.p.reload();
        await friend.p.getByRole("button", { name: "Remove member", exact: true }).click();
        await friend.p.getByRole("button", { name: "Remove this member", exact: true }).click();
        await friend.p.waitForTimeout(500);
        await host.p.reload();
        await host.p
            .getByRole("button", { name: "Join the planning space", exact: true })
            .waitFor();
        await other.p.locator("[data-account-action=signout-all]").click();
        await other.p.locator("#accountStatus").waitFor();
        const session = await (await friend.c.request.get(base + "/api/auth/session")).json();
        assert.equal(session.account, null);
        assert.deepEqual(errors, []);
        console.log(
            "PASS account UI: create, invite, account join, cross-device profile, organizer transfer, removal and all-device sign-out (fixture identity verification)",
        );
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
