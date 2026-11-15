"use strict";
// Maintainer-only asset preparation. Committed fonts need no runtime downloads.
const fs = require("node:fs/promises"),
    path = require("node:path"),
    crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
    revision = "2eb0b48d5f760f62e286216f0859a8c540dbc1bd",
    base = `https://raw.githubusercontent.com/google/fonts/${revision}/`;
const families = [
    ["dm-sans", "ofl/dmsans", "DMSans[opsz,wght].ttf", "OFL.txt"],
    ["patrick-hand", "ofl/patrickhand", "PatrickHand-Regular.ttf", "OFL.txt"],
    ["permanent-marker", "apache/permanentmarker", "PermanentMarker-Regular.ttf", "LICENSE.txt"],
];
async function download(relative) {
    const response = await fetch(base + relative.split("/").map(encodeURIComponent).join("/"), {
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Font source returned ${response.status}: ${relative}`);
    return Buffer.from(await response.arrayBuffer());
}
(async () => {
    const records = [];
    for (const [name, directory, filename, license] of families) {
        const [font, text] = await Promise.all([
            download(`${directory}/${filename}`),
            download(`${directory}/${license}`),
        ]);
        if (
            font.length < 1000 ||
            font.length > 2000000 ||
            !["00010000", "4f54544f"].includes(font.subarray(0, 4).toString("hex"))
        )
            throw new Error(`Invalid font: ${name}`);
        const fontDir = path.join(root, "public", "assets", "fonts"),
            licenseDir = path.join(root, "licenses", "web-fonts", name);
        await fs.mkdir(fontDir, { recursive: true });
        await fs.mkdir(licenseDir, { recursive: true });
        await fs.writeFile(path.join(fontDir, name + ".ttf"), font);
        await fs.writeFile(path.join(licenseDir, license), text);
        records.push(
            `- ${name}: [source](${base}${directory}/${encodeURIComponent(filename)}), SHA-256 \`${crypto.createHash("sha256").update(font).digest("hex")}\`. License: [${license}](${name}/${license}).`,
        );
    }
    await fs.writeFile(
        path.join(root, "licenses", "web-fonts", "README.md"),
        `# Self-hosted web fonts\n\nOriginal, unmodified Google Fonts assets pinned to repository revision \`${revision}\`. The family licenses are retained beside this file. Fonts are served locally through shared.css on all three pages. Regenerate with \`pnpm run prepare:fonts\`; normal installs and deployment do not download fonts.\n\n${records.join("\n")}\n`,
    );
    console.log("Prepared three local web fonts and their licenses.");
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
