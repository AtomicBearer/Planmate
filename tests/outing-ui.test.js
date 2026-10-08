"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    C = require("../planner-core"),
    Utils = require("../browser-utils");

function deferred() {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
}
function page(module, options = {}) {
    const events = {},
        frames = new Map(),
        route = { dataset: { routeResult: "b" }, textContent: "" };
    let mapHtml = "",
        selectedDay = "2026-10-09",
        imageCount = 0;
    const workspace = {
        set innerHTML(value) {
            this.html = value;
            frames.clear();
            for (const [, id] of value.matchAll(/data-photo-id="([^"]+)"/g))
                frames.set(id, {
                    dataset: { photoId: id },
                    textContent: "",
                    children: [],
                    replaceChildren() {
                        this.children = [];
                        this.textContent = "";
                    },
                    append(child) {
                        this.children.push(child);
                    },
                });
        },
        insertAdjacentHTML(position, value) {
            mapHtml = value;
        },
    };
    const mapPanel = {
        querySelector() {
            return { textContent: "Our day, on the map" };
        },
        replaceWith(value) {
            mapHtml = value.html;
        },
    };
    const document = {
        getElementById() {
            return workspace;
        },
        addEventListener(type, handler) {
            (events[type] ||= []).push(handler);
        },
        querySelectorAll(selector) {
            if (selector === "#workspace .plan-panel") return [mapPanel];
            if (selector === "[data-photo-id]") return [...frames.values()];
            if (selector === "[data-route-result]") return [route];
            return [];
        },
        createElement() {
            return {
                dataset: {},
                set innerHTML(value) {
                    this.firstElementChild = { html: value };
                },
                addEventListener() {},
            };
        },
    };
    const state = C.createState(
        { title: "UI fixture", city: "Goa", start: selectedDay, end: "2026-10-10", budget: 1000 },
        { id: "host", name: "Host" },
    );
    state.stops = ["a", "b"].map((id, i) => ({
        id,
        date: selectedDay,
        start: i ? "12:00" : "09:00",
        end: i ? "13:00" : "10:00",
        travel: 0,
        cost: 0,
        costKnown: false,
        travelKnown: false,
        place: {
            id,
            name: id,
            city: "Goa",
            coordinates: { latitude: 15 + i, longitude: 73, source: "https://example.com" },
        },
    }));
    const adapter = {
        state: () => state,
        memberId: () => "host",
        groupCode: () => "trip",
        memberName: () => "Host",
        selectedDay: () => selectedDay,
        initialTodayDay: () =>
            typeof options.initialTodayDay === "function"
                ? options.initialTodayDay()
                : options.initialTodayDay || "",
        setSelectedDay(day) {
            selectedDay = day;
        },
        setView(view) {
            ui.render(view);
        },
        displayPlace: (p) => p,
        money: String,
        mapsUrl: () => "https://example.com",
        toast() {},
        request: async () => ({}),
        blobRequest: async () => ({}),
    };
    const window = { PlannerCore: C, PlanmateUtils: Utils };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../" + module), "utf8"), {
        window,
        document,
        Date,
        Intl,
        URL: { createObjectURL: () => `blob:test-${++imageCount}`, revokeObjectURL() {} },
    });
    const ui = window[module === "outing-ui.js" ? "OutingUI" : "MemoriesUI"].init(adapter, {
        button: (action, label) => `<button>${label}</button>`,
        field: (label, input) => input,
        panel: (title, body) => `<section><h2>${title}</h2>${body}</section>`,
        notice: String,
        run() {},
    });
    return {
        state,
        adapter,
        ui,
        frames,
        route,
        get mapHtml() {
            return mapHtml;
        },
        get selectedDay() {
            return selectedDay;
        },
        async click(action, id = "") {
            for (const handler of events.click)
                await handler({
                    target: {
                        closest: () => ({
                            dataset: { planAction: action, id },
                            disabled: false,
                        }),
                    },
                });
        },
        changeDay(value) {
            for (const handler of events.change) handler({ target: { id: "mapDay", value } });
        },
        changeToday(value) {
            for (const handler of events.change) handler({ target: { id: "todayDay", value } });
        },
    };
}

test("map selection follows the itinerary day and locating a stop updates the shared day", async () => {
    const p = page("outing-ui.js");
    p.state.stops[1].date = "2026-10-10";
    p.ui.render("itinerary");
    assert.match(p.mapHtml, /option selected>2026-10-09/);
    await p.click("locate", "b");
    assert.equal(p.selectedDay, "2026-10-10");
    assert.match(p.mapHtml, /option selected>2026-10-10/);
    p.changeDay("2026-10-09");
    assert.equal(p.selectedDay, "2026-10-09");
});

test("Today restores a requested trip day and distinguishes the actual current day", () => {
    const p = page("outing-ui.js", { initialTodayDay: "2026-10-10" });
    p.ui.render("today");
    assert.equal(p.ui.todayDay(), "2026-10-10");
    p.changeToday("2026-10-09");
    assert.equal(p.ui.todayDay(), "2026-10-09");
    assert.equal(p.selectedDay, "2026-10-09");
    p.changeToday("");
    assert.equal(p.ui.todayDay(), "");
    p.changeToday("2026-10-10");
    p.state.stops = [];
    p.state.trip.end = "2026-10-09";
    p.ui.render("today");
    assert.equal(p.ui.todayDay(), "");
});

test("the requested Today date survives an initial preview before the shared trip loads", () => {
    let loaded = false;
    const p = page("outing-ui.js", { initialTodayDay: () => (loaded ? "2026-10-10" : "") });
    p.ui.render("today");
    assert.equal(p.ui.todayDay(), "");
    loaded = true;
    p.adapter.groupCode = () => "loaded-trip";
    p.ui.render("today");
    assert.equal(p.ui.todayDay(), "2026-10-10");
});

test("a delayed map image cannot appear on a different trip day", async () => {
    const p = page("outing-ui.js"),
        image = deferred();
    p.state.stops[1].date = "2026-10-10";
    p.adapter.request = async () => ({ points: [], imageToken: "old-day" });
    p.adapter.blobRequest = () => image.promise;
    p.ui.render("itinerary");
    const loading = p.click("refresh-map");
    await Promise.resolve();
    p.adapter.setSelectedDay("2026-10-10");
    p.ui.render("itinerary");
    image.resolve({});
    await loading;
    assert.match(p.mapHtml, /option selected>2026-10-10/);
    assert.doesNotMatch(p.mapHtml, /blob:test|Google map of this day's locations/);
});

test("reorder undo is shown only to an allowed member while that order is still current", () => {
    const p = page("outing-ui.js");
    p.state.reorderUndo = { by: "friend", before: [], after: C.clone(p.state.stops) };
    p.ui.render("itinerary");
    assert.match(p.mapHtml, /Undo last reorder/);
    p.adapter.memberId = () => "other";
    p.ui.render("itinerary");
    assert.doesNotMatch(p.mapHtml, /Undo last reorder/);
    p.adapter.memberId = () => "host";
    p.state.stops[0].note = "Edited after the reorder";
    p.ui.render("itinerary");
    assert.doesNotMatch(p.mapHtml, /Undo last reorder/);
});

test("a delayed route result is discarded after its itinerary leg changes", async () => {
    const p = page("outing-ui.js"),
        response = deferred();
    p.adapter.request = () => response.promise;
    p.ui.render("itinerary");
    const loading = p.click("route", "b");
    p.state.stops[1].date = "2026-10-10";
    p.ui.render("itinerary");
    response.resolve({
        provider: "Fixture route",
        durationSeconds: 600,
        distanceMeters: 1000,
        checkedAt: new Date().toISOString(),
        sourceUrl: "https://example.com",
    });
    await loading;
    assert.equal(p.route.textContent, "");
});

test("photo downloads fill the current scrapbook after a shared refresh replaces its cards", async () => {
    const p = page("memories-ui.js"),
        photo = deferred();
    p.state.visits.a = { by: "host", at: new Date().toISOString() };
    p.state.scrapbook.push({
        id: "photo",
        stopId: "a",
        by: "host",
        caption: "Our memory",
        createdAt: new Date().toISOString(),
    });
    p.adapter.blobRequest = () => photo.promise;
    p.ui.render("scrapbook");
    const old = p.frames.get("photo");
    p.ui.render("scrapbook");
    const current = p.frames.get("photo");
    assert.notEqual(current, old);
    photo.resolve({});
    await new Promise((r) => setImmediate(r));
    assert.equal(current.children.length, 1, current.textContent);
    assert.equal(current.children[0].alt, "Our memory");
    assert.equal(old.children.length, 0);
});
