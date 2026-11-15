"use strict";
const assert = require("node:assert/strict"),
    http = require("node:http"),
    fs = require("node:fs"),
    path = require("node:path");
const { launchBrowser } = require("./helpers.cjs"),
    { fixture } = require("../netlify-fixture.cjs");
const { buildNetlify } = require("../../scripts/build-netlify");
const publicFiles = new Set([...require("../../server/public-files"), "index.html"]);
(async () => {
    const output = buildNetlify(path.resolve("output/netlify-shared-test-browser"), {
        shared: true,
    });
    const f = fixture(),
        errors = [];
    let origin;
    const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".ttf": "font/ttf",
    };
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, origin);
            if (url.pathname.startsWith("/api/")) {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                const response = await f.handler()(
                    new Request(url, {
                        method: req.method,
                        headers: req.headers,
                        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
                    }),
                );
                res.writeHead(response.status, Object.fromEntries(response.headers));
                return res.end(Buffer.from(await response.arrayBuffer()));
            }
            const file = url.pathname.slice(1) || "index.html";
            if (!publicFiles.has(file)) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, {
                "Content-Type": mime[path.extname(file)] || "application/octet-stream",
            });
            res.end(fs.readFileSync(path.join(output, file)));
        } catch (error) {
            errors.push(error.message);
            res.writeHead(500);
            res.end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = "http://127.0.0.1:" + server.address().port;
    const browser = await launchBrowser();
    try {
        const pages = [];
        for (let i = 0; i < 3; i++) {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 900 },
                reducedMotion: "reduce",
            });
            const page = await context.newPage();
            page.on("pageerror", (error) => errors.push(error.message));
            pages.push(page);
        }
        const [owner, first, second] = pages;
        await owner.goto(origin + "/dashboard.html");
        await owner.locator('#entryGuide [data-action="new-trip"]').click();
        let form = owner.locator('[data-form="new-trip"]');
        await form.locator('[name="title"]').fill("Chikkamagaluru with friends");
        await form.locator('[name="city"]').fill("Chikmagalur");
        await form.locator('[name="start"]').fill("2027-01-16");
        await form.locator('[name="end"]').fill("2027-01-19");
        await form.locator('[name="budget"]').fill("8000");
        await form.locator('[name="name"]').fill("Explorer one");
        await form.locator('[name="shared"]').check();
        await form.getByRole("button", { name: "Create planning space" }).click();
        await owner
            .getByRole("heading", { name: "Chikkamagaluru with friends", exact: true })
            .waitFor();
        await owner.locator('#sideNav [data-view="discover"]').click();
        await owner.locator("#browseCity").selectOption("Chikkamagaluru");
        assert.match(await owner.locator(".results-line").innerText(), /60 options/);
        await owner.locator("#regionEvidence").selectOption("research_lead");
        assert.match(await owner.locator(".results-line").innerText(), /13 options/);
        await owner.locator("#regionEvidence").selectOption("All");
        await owner.locator("#regionCluster").selectOption("Hill circuit");
        await owner
            .locator('[data-action="details"][data-id="ckm-mullayanagiri-baba-ridge"]')
            .first()
            .click();
        assert.match(await owner.locator("#appDialog").innerText(), /Bridge unverified/);
        assert.equal(
            (await owner.locator('#appDialog a[href*="indiahikes.com"]').count()) > 0,
            true,
        );
        await owner.locator('[data-action="close-dialog"]').click();
        await owner.screenshot({
            path: "test-results/chikkamagaluru-discovery.png",
            fullPage: true,
        });
        await owner.locator('#sideNav [data-view="group"]').click();
        await owner.getByRole("button", { name: "Invite a friend", exact: true }).click();
        const invitation = await owner.locator(".invite-link").innerText();
        for (const [i, page] of [first, second].entries()) {
            await page.goto(invitation);
            const join = page.locator('[data-form="join"]');
            await join.locator('[name="name"]').fill("Explorer " + (i + 2));
            await join.getByRole("button", { name: "Join the planning space" }).click();
            await page
                .getByRole("heading", { name: "Chikkamagaluru with friends", exact: true })
                .waitFor();
            await page.locator('#sideNav [data-view="itinerary"]').click();
        }
        await owner.reload();
        await owner.locator('#sideNav [data-view="itinerary"]').click();
        await owner.locator('[data-train-action="add"]').click();
        form = owner.locator('[data-train-form="journey"]');
        await form.locator('[name="from"]').fill("Mumbai station to be chosen");
        await form.locator('[name="to"]').fill("Birur (RRB)");
        await form.locator('[name="departureDate"]').fill("2027-01-15");
        await form.locator('[name="arrivalDate"]').fill("2027-01-16");
        await form
            .locator('[name="note"]')
            .fill("Meet at the station. Train times still to be confirmed.");
        await form.getByRole("button", { name: "Save journey" }).click();
        await owner.locator("#appDialog:not([open])").waitFor({ state: "attached" });
        for (const page of [first, second]) {
            await page
                .locator("#trainJourneys")
                .getByText("Birur (RRB)", { exact: false })
                .waitFor();
            assert.match(await page.locator("#trainJourneys").innerText(), /Time unknown/);
            assert.equal(await page.locator('[data-train-action="edit"]').count(), 0);
        }
        await first.locator('#sideNav [data-view="discover"]').click();
        await first.locator("#browseCity").selectOption("Chikkamagaluru");
        await first.locator('[data-action="propose"][data-id="ckm-mullayanagiri-summit"]').click();
        await first.locator('[data-form="propose"] button[type="submit"]').click();
        await first.locator("#appDialog:not([open])").waitFor({ state: "attached" });
        await second.locator('#sideNav [data-view="ideas"]').click();
        await second.locator(".idea-card").filter({ hasText: "Mullayanagiri summit" }).waitFor();
        await owner.reload();
        await owner.locator('#sideNav [data-view="itinerary"]').click();
        await owner.screenshot({
            path: "test-results/chikkamagaluru-trains-desktop.png",
            fullPage: true,
        });
        const downloadPromise = owner.waitForEvent("download");
        await owner.locator('[data-action="export"]').click();
        const download = await downloadPromise;
        await download.saveAs("test-results/chikkamagaluru-trains.pdf");
        const bytes = fs.readFileSync("test-results/chikkamagaluru-trains.pdf");
        assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
        const pdf = await require("pdf-lib").PDFDocument.load(bytes);
        assert.equal(pdf.getPageCount(), 5);
        for (const width of [390, 320]) {
            await owner.setViewportSize({ width, height: 844 });
            assert.equal(
                await owner.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                false,
            );
            await owner.screenshot({
                path: "test-results/chikkamagaluru-trains-" + width + ".png",
                fullPage: true,
            });
        }
        await owner.reload();
        await owner.locator('#sideNav [data-view="itinerary"]').click();
        assert.match(
            await owner.locator("#trainJourneys").innerText(),
            /Mumbai station to be chosen/,
        );
        assert.equal(await owner.locator("#draftRecovery").isVisible(), false);
        assert.deepEqual(errors, []);
        console.log(
            "Regional catalogue, three-browser invitations, shared trains, PDF and mobile checks passed.",
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
