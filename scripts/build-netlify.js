"use strict";
const fs = require("node:fs"),
    path = require("node:path"),
    publicFiles = require("../server/public-files"),
    { resolvePublicFile, aliases } = require("../server/static-files");
const root = path.resolve(__dirname, ".."),
    outputRoot = path.join(root, "output");
const licenseFiles = Object.freeze([
    "licenses/pdf-export/regenerator-LICENSE.txt",
    "licenses/pdf-export/pdf-lib-LICENSE.md",
    "licenses/pdf-export/PatrickHand-OFL.txt",
    "licenses/pdf-export/NotoEmoji-OFL.txt",
    "licenses/pdf-export/Noto-OFL.txt",
    "licenses/pdf-export/fontkit-LICENSE.txt",
    "licenses/pdf-export/font-sources.json",
    "licenses/web-fonts/README.md",
    "licenses/web-fonts/permanent-marker/LICENSE.txt",
    "licenses/web-fonts/patrick-hand/OFL.txt",
    "licenses/web-fonts/dm-sans/OFL.txt",
]);
function buildNetlify(target = path.join(outputRoot, "netlify"), { shared = false } = {}) {
    target = path.resolve(target);
    // Only a dedicated child of this project's output directory may be replaced.
    if (target === outputRoot || !target.startsWith(outputRoot + path.sep))
        throw new Error("Choose a dedicated folder inside the project's output directory.");
    fs.mkdirSync(outputRoot, { recursive: true });
    for (const candidate of [outputRoot, target]) {
        if (
            fs.existsSync(candidate) &&
            !fs.realpathSync(candidate).startsWith(fs.realpathSync(root) + path.sep)
        )
            throw new Error("Build output must stay inside this project.");
    }
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const file of publicFiles) {
        const source = resolvePublicFile(file).absolute,
            destination = path.join(target, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (file.endsWith(".html")) {
            const html = fs
                .readFileSync(source, "utf8")
                .replace(
                    "<head>",
                    shared ? "<head>" : '<head>\n        <meta name="planmate-storage" content="device" />',
                );
            fs.writeFileSync(destination, html);
        } else fs.copyFileSync(source, destination);
    }
    fs.copyFileSync(path.join(target, "login.html"), path.join(target, "index.html"));
    // Retain the redistribution notices for the bundled fonts/PDF libraries.
    for (const file of licenseFiles) {
        const destination = path.join(target, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, file), destination);
    }
    fs.writeFileSync(
        path.join(target, "_redirects"),
        Object.entries(aliases)
            .map(([old, canonical]) => `/${old} /${canonical} 200`)
            .join("\n") + "\n",
    );
    fs.writeFileSync(
        path.join(target, "_headers"),
        `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cache-Control: no-cache
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
`,
    );
    return target;
}
if (require.main === module) {
    const shared = process.argv.includes("--shared");
    console.log("Netlify output folder: " + buildNetlify(undefined, { shared }));
    console.log(
        shared ? "Deploy with the Netlify functions from this repository to enable shared trips." :
            "Personal plans use browser storage. Shared trips and private photo uploads need a server deployment.",
    );
}
module.exports = { buildNetlify, licenseFiles };
