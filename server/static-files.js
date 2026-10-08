"use strict";
const path = require("node:path");
const publicFiles = require("./public-files.js");
const allowed = new Set(publicFiles);
const root = path.resolve(__dirname, "..");
// Old asset URLs remain valid for open tabs and bookmarks. Only explicitly public files qualify.
const aliases = Object.freeze(
    Object.fromEntries(
        publicFiles
            .filter((file) => /^(?:css|js|shared)\//.test(file))
            .map((file) => [path.posix.basename(file), file]),
    ),
);
function resolvePublicFile(file) {
    const canonical = aliases[file] || file;
    if (!allowed.has(canonical)) return null;
    return {
        file: canonical,
        absolute: path.join(root, canonical.startsWith("shared/") ? "" : "public", canonical),
    };
}
module.exports = { resolvePublicFile, aliases };
