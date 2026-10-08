"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const publicFiles = require("../public-files");

const root = path.resolve(__dirname, "..");
const publicSet = new Set(publicFiles);
const serverFiles = new Set([
    "server.js",
    "plan-store.js",
    "account-service.js",
    "discovery.js",
    "public-files.js",
    "map-service.js",
    "media-store.js",
]);
const references = new Set();
const problems = [];
const dependencies = {
    "group-fit.js": ["planning-time.js"],
    "form-drafts.js": ["browser-utils.js"],
    "planning-rules.js": [
        "planning-time.js",
        "group-fit.js",
        "outing-rules.js",
        "expense-rules.js",
    ],
    "planner-core.js": ["planning-rules.js"],
    "group-planning.js": [
        "planner-ui.js",
        "browser-utils.js",
        "planner-core.js",
        "profile-store.js",
        "outing-ui.js",
        "memories-ui.js",
    ],
    "outing-ui.js": ["planner-core.js", "browser-utils.js"],
    "memories-ui.js": ["planner-core.js", "browser-utils.js"],
    "profile-store.js": ["browser-utils.js", "profile-rules.js"],
    "planner-ui.js": ["browser-utils.js"],
    "profile.js": ["browser-utils.js", "catalogue.js", "profile-store.js"],
    "itinerary-export.js": ["planner-core.js"],
    "dashboard.js": [
        "dashboard-navigation.js",
        "shared-sync.js",
        "planner-ui.js",
        "dashboard-renderers.js",
        "place-illustrations.js",
        "account-client.js",
        "form-drafts.js",
        "browser-utils.js",
        "planner-core.js",
        "catalogue.js",
        "profile-store.js",
        "itinerary-export.js",
        "group-planning.js",
    ],
};

function report(file, message) {
    problems.push(`${file}: ${message}`);
}

function attributes(tag) {
    return Object.fromEntries(
        [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
            match[1].toLowerCase(),
            match[2] ?? match[3],
        ]),
    );
}

function reference(from, value) {
    if (!value || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(value)) return;
    const pathname = value.split(/[?#]/)[0];
    if (!pathname) return;
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(from), pathname));
    if (!publicSet.has(file)) report(from, `${value} is not in public-files.js`);
    if (!fs.existsSync(path.join(root, file))) report(from, `${value} is missing`);
    references.add(file);
}

function checkHtml(file, source) {
    const html = source.replace(/<!--[\s\S]*?-->/g, "");
    const tags = [...html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)];
    const ids = new Set();
    for (const [tag] of tags) {
        const { id } = attributes(tag);
        if (!id) continue;
        if (ids.has(id)) report(file, `duplicate id ${id}`);
        ids.add(id);
    }
    const scripts = [];
    for (const [tag, name] of tags) {
        const attrs = attributes(tag);
        for (const attribute of ["href", "src"]) {
            const value = attrs[attribute];
            if (value?.startsWith("#") && value.length > 1 && !ids.has(value.slice(1))) {
                report(file, `${value} has no matching element`);
            }
            reference(file, value);
        }
        if (name.toLowerCase() === "script" && attrs.src && !/^https?:/.test(attrs.src)) {
            scripts.push(attrs.src);
            for (const dependency of dependencies[attrs.src] || []) {
                if (!scripts.includes(dependency)) {
                    report(file, `${dependency} must load before ${attrs.src}`);
                }
            }
        }
    }
}

if (publicSet.size !== publicFiles.length) report("public-files.js", "duplicate public files");
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || serverFiles.has(entry.name)) continue;
    if (/\.(html|css|js)$/.test(entry.name) && !publicSet.has(entry.name)) {
        report(entry.name, "browser file is missing from public-files.js");
    }
}
function checkAssets(directory, prefix = "assets") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) checkAssets(path.join(directory, entry.name), file);
        else if (!publicSet.has(file)) report(file, "asset is missing from public-files.js");
    }
}
checkAssets(path.join(root, "assets"));
for (const file of publicFiles) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
        report("public-files.js", `${file} is missing`);
        continue;
    }
    const source = fs.readFileSync(absolute, "utf8");
    if (file.endsWith(".html")) {
        references.add(file);
        checkHtml(file, source);
    }
    if (file.endsWith(".css")) {
        for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
            reference(file, match[1]);
        }
    }
    if (file.endsWith(".js") && !file.startsWith("assets/")) {
        for (const match of source.matchAll(/loadScript\(["']([^"']+)["']\)/g))
            reference(file, match[1]);
    }
}
for (const file of publicFiles) {
    if (!references.has(file)) report(file, "public file is not linked from a page or stylesheet");
}

function checkJavaScript(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || ["node_modules", "data"].includes(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            checkJavaScript(absolute);
        } else if (/\.(js|cjs)$/.test(entry.name)) {
            const file = path.relative(root, absolute);
            const source = fs.readFileSync(absolute, "utf8");
            try {
                new vm.Script(source, { filename: file });
            } catch (error) {
                report(file, error.message);
            }
            for (const match of source.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
                const target = path.resolve(directory, match[1]);
                if (!fs.existsSync(target) && !fs.existsSync(`${target}.js`)) {
                    report(file, `required module ${match[1]} is missing`);
                }
            }
        }
    }
}
checkJavaScript(root);

if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
} else {
    console.log(
        `Project checks passed: ${publicFiles.length} linked public files, script order and JavaScript syntax.`,
    );
}
