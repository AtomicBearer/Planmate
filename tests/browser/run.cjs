"use strict";
const { spawn } = require("node:child_process"),
    path = require("node:path");
const cases = [
    "loading",
    "profile-context",
    "cohesion",
    "planning",
    "drafts",
    "account",
    "discovery-ui",
    "night-fit",
    "product",
    "netlify-upload",
    "regional-sharing",
];
(async () => {
    const selected = process.argv.slice(2).filter((argument) => argument !== "--");
    for (const name of selected.length ? selected : cases) {
        if (!cases.includes(name)) throw new Error("Unknown browser case: " + name);
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(__dirname, name + ".cjs")], {
                stdio: "inherit",
                env: process.env,
            });
            const timeout = setTimeout(() => {
                child.kill();
                reject(new Error(name + " exceeded four minutes"));
            }, 240000);
            child.once("error", (e) => {
                clearTimeout(timeout);
                reject(e);
            });
            child.once("exit", (code) => {
                clearTimeout(timeout);
                code === 0 ? resolve() : reject(new Error(name + " failed with exit code " + code));
            });
        });
    }
})().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
