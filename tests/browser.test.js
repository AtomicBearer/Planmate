"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { escapeHtml, readJson } = require("../public/js/browser-utils.js");

test("shared HTML escaping keeps user names and attribute values as text", () => {
    assert.equal(
        escapeHtml("<img src=\"x\" onerror='alert(1)'> &"),
        "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt; &amp;",
    );
    assert.equal(escapeHtml("José 🏖️"), "José 🏖️");
    assert.equal(escapeHtml(null), "");
});

test("storage reads preserve valid values and recover from missing, corrupt or blocked data", () => {
    const fallback = { name: "You" };
    for (const value of [null, "null", "invalid JSON"]) {
        assert.equal(readJson("profile", fallback, { getItem: () => value }), fallback);
    }
    assert.equal(readJson("flag", true, { getItem: () => "false" }), false);
    assert.deepEqual(readJson("profile", fallback, { getItem: () => '{"name":"Riya"}' }), {
        name: "Riya",
    });
    assert.equal(
        readJson("profile", fallback, {
            getItem: () => {
                throw new Error("Storage blocked");
            },
        }),
        fallback,
    );
});

function loginPage(search = "", storageError = false) {
    const elements = new Map(),
        stored = new Map(),
        timers = [];
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set(),
                handlers = new Map();
            elements.set(id, {
                value: "",
                textContent: "",
                classList: {
                    add: (name) => classes.add(name),
                    remove: (name) => classes.delete(name),
                    toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
                    contains: (name) => classes.has(name),
                },
                addEventListener: (event, callback) => handlers.set(event, callback),
                trigger: (event) => handlers.get(event)?.({ preventDefault() {} }),
                focus() {},
                scrollIntoView() {},
            });
        }
        return elements.get(id);
    }
    const context = {
        document: { getElementById: element },
        localStorage: {
            setItem: (key, value) => {
                if (storageError) throw new Error("Storage blocked");
                stored.set(key, value);
            },
        },
        window: { location: { href: "login.html", search } },
        URLSearchParams,
        setTimeout: (callback, delay) => timers.push({ callback, delay }),
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        console: { error() {} },
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "../public/js/login.js"), "utf8"),
        context,
    );
    return { element, stored, timers, context };
}

test("local profile entry validates name and email and saves optional contact without credentials", () => {
    const page = loginPage();
    page.element("loginForm").trigger("submit");
    assert.equal(page.stored.size, 0);
    assert.equal(page.element("nameError").textContent, "Please enter your name.");
    assert.equal(page.element("emailError").textContent, "Please enter a valid email address.");
    for (const [id, value] of Object.entries({
        fullName: " Riya ",
        email: "riya@example.com",
        contact: "+91 (98765) 43210",
    })) {
        page.element(id).value = value;
    }
    page.element("loginForm").trigger("submit");
    assert.deepEqual(JSON.parse(page.stored.get("PlanmateUser")), {
        name: "Riya",
        email: "riya@example.com",
        contact: "+91 (98765) 43210",
        loginMethod: "local-profile",
    });
    assert.equal(page.element("continueButton").disabled, true);
    const redirect = page.timers.find((timer) => timer.delay === 1200);
    assert.ok(redirect);
    redirect.callback();
    assert.equal(page.context.window.location.href, "dashboard.html");
});

test("unconfigured Google credentials cannot establish a profile or account", async () => {
    const page = loginPage();
    await page.context.handleCredentialResponse({ credential: "header.payload.signature" });
    assert.equal(page.element("fullName").value, "");
    assert.equal(page.stored.size, 0);
    assert.equal(page.element("toastTitle").textContent, "Sign-in unavailable");
    assert.match(page.element("toastMessage").textContent, /not configured/);
});

test("local profile entry permits no contact, rejects malformed contact and reports blocked storage", () => {
    const page = loginPage();
    page.element("fullName").value = "Riya";
    page.element("email").value = "riya@example.test";
    page.element("contact").value = "not a number";
    page.element("loginForm").trigger("submit");
    assert.equal(page.stored.size, 0);
    assert.equal(page.element("contactError").textContent, "Please enter a valid contact number.");
    page.element("contact").value = "";
    page.element("loginForm").trigger("submit");
    assert.equal(JSON.parse(page.stored.get("PlanmateUser")).contact, "");
    page.element("loginForm").trigger("submit");
    assert.equal(page.timers.filter((timer) => timer.delay === 1200).length, 1);
    const blocked = loginPage("", true);
    blocked.element("fullName").value = "Riya";
    blocked.element("email").value = "riya@example.test";
    blocked.element("loginForm").trigger("submit");
    assert.equal(blocked.element("toastTitle").textContent, "Details couldn’t be saved");
    assert.equal(blocked.timers.filter((timer) => timer.delay === 1200).length, 0);
});

test("profile entry continues to the same planning context using only allowed navigation parameters", () => {
    const page = loginPage(
        "?group=abcdefghijklmnop&space=other&view=today&day=2026-10-08&next=https://example.test",
    );
    assert.equal(
        page.context.dashboardReturnUrl(),
        "dashboard.html?group=abcdefghijklmnop&view=today&day=2026-10-08",
    );
    page.context.window.location.search = "?space=local-trip&view=itinerary&day=2026-02-31";
    assert.equal(
        page.context.dashboardReturnUrl(),
        "dashboard.html?space=local-trip&view=itinerary",
    );
    page.context.window.location.search =
        "?group=invalid&space=../outside&view=unknown&day=bad&next=//example.test";
    assert.equal(page.context.dashboardReturnUrl(), "dashboard.html");
});
