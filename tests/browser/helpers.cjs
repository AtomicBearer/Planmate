"use strict";
const fs = require("node:fs"),
    { chromium } = require("playwright");
async function launchBrowser() {
    fs.mkdirSync("test-results", { recursive: true });
    return chromium.launch({
        headless: true,
        ...(process.env.PLANMATE_BROWSER_CHANNEL
            ? { channel: process.env.PLANMATE_BROWSER_CHANNEL }
            : {}),
    });
}
module.exports = { launchBrowser };
