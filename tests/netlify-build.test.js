"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    { buildNetlify, licenseFiles } = require("../scripts/build-netlify"),
    publicFiles = require("../server/public-files");
const root = path.resolve(__dirname, ".."),
    outputRoot = path.join(root, "output");
function fixture() {
    fs.mkdirSync(outputRoot, { recursive: true });
    return fs.mkdtempSync(path.join(outputRoot, "netlify-test-"));
}
function files(directory, prefix = "") {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const name = prefix + entry.name;
        return entry.isDirectory() ? files(path.join(directory, entry.name), name + "/") : [name];
    });
}
test("Netlify folder contains complete public assets, an empty device-storage entry and no private source or data", () => {
    const target = fixture();
    try {
        buildNetlify(target);
        assert.deepEqual(
            files(target).sort(),
            [...publicFiles, ...licenseFiles, "index.html", "_headers", "_redirects"].sort(),
        );
        assert.equal(
            fs.readFileSync(path.join(target, "index.html"), "utf8"),
            fs.readFileSync(path.join(target, "login.html"), "utf8"),
        );
        for (const page of ["index.html", "login.html", "dashboard.html", "profile.html"])
            assert.match(
                fs.readFileSync(path.join(target, page), "utf8"),
                /name="planmate-storage" content="device"/,
            );
        assert.match(
            fs.readFileSync(path.join(target, "_headers"), "utf8"),
            /X-Content-Type-Options: nosniff/,
        );
        assert.match(
            fs.readFileSync(path.join(target, "_redirects"), "utf8"),
            /\/dashboard.js \/js\/dashboard.js 200/,
        );
        assert.ok(fs.statSync(path.join(target, "assets/fonts/patrick-hand.ttf")).size > 1000);
    } finally {
        fs.rmSync(target, { recursive: true, force: true });
    }
});
test("rebuilding an upload removes stale/private files from its previous contents", () => {
    const target = fixture();
    try {
        buildNetlify(target);
        fs.writeFileSync(path.join(target, ".env"), "not-for-publishing");
        fs.writeFileSync(path.join(target, "old-server.js"), "not-for-publishing");
        buildNetlify(target);
        assert.equal(fs.existsSync(path.join(target, ".env")), false);
        assert.equal(fs.existsSync(path.join(target, "old-server.js")), false);
    } finally {
        fs.rmSync(target, { recursive: true, force: true });
    }
});
test("upload build refuses to replace source folders or the parent output directory", () => {
    for (const target of [root, path.join(root, "public"), outputRoot, path.dirname(root)])
        assert.throws(() => buildNetlify(target), /dedicated folder/);
    assert.equal(fs.existsSync(path.join(root, "public", "dashboard.html")), true);
});

test("shared build enables the API while shipping only browser assets", () => {
    const target = fixture();
    try {
        buildNetlify(target, { shared: true });
        for (const page of ["index.html", "dashboard.html", "profile.html"])
            assert.doesNotMatch(
                fs.readFileSync(path.join(target, page), "utf8"),
                /content="device"/,
            );
        assert.ok(fs.existsSync(path.join(target, "shared/chikkamagaluru.js")));
        assert.ok(fs.existsSync(path.join(target, "js/train-ui.js")));
        assert.equal(
            files(target).some((name) => /(^|\/)\.env|^server\/|^netlify\//.test(name)),
            false,
        );
    } finally {
        fs.rmSync(target, { recursive: true, force: true });
    }
});
