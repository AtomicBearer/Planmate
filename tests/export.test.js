"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../planner-core");
const catalogue = require("../catalogue");
const exporter = require("../itinerary-export");
require("../assets/vendor/regenerator-runtime");
const libraries = {
    PDFLib: require("../assets/vendor/pdf-lib.min.js"),
    fontkit: require("../assets/vendor/fontkit.umd.min.js"),
    fonts: require("../assets/pdf-fonts.js"),
};
function plan(changes = {}) {
    const state = Core.createState(
        {
            title: "Goa, here we come",
            city: "Goa",
            start: "2026-10-09",
            end: "2026-10-11",
            budget: 5000,
            ...changes,
        },
        { id: "you", name: "You" },
    );
    state.stops = [
        {
            id: "late",
            date: "2026-10-09",
            start: "23:00",
            end: "01:00",
            endNextDay: true,
            cost: 750,
            travel: 30,
            place: catalogue.places[3],
            note: "Remember to check the programme.",
        },
        {
            id: "early",
            date: "2026-10-09",
            start: "09:00",
            end: "10:30",
            endNextDay: false,
            cost: 0,
            travel: 0,
            place: catalogue.places[0],
            note: "Meet near the beach.",
        },
    ];
    return state;
}
test("PDF model distinguishes explicit zero estimates from unknown costs", () => {
    const state = plan();
    state.stops[0].costKnown = true;
    state.stops[1].costKnown = false;
    assert.equal(exporter.buildModel(state).unknownCosts, 1);
    state.stops[1].costKnown = true;
    assert.equal(exporter.buildModel(state).unknownCosts, 0);
});

test("PDF model preserves chronological stops, empty days, overnight times and budget totals", () => {
    const state = plan(),
        original = Core.clone(state);
    const model = exporter.buildModel(state);
    assert.deepEqual(
        model.days.map((day) => day.date),
        ["2026-10-09", "2026-10-10", "2026-10-11"],
    );
    assert.deepEqual(
        model.days[0].stops.map((stop) => stop.id),
        ["early", "late"],
    );
    assert.equal(model.days[0].stops[1].endNextDay, true);
    assert.equal(model.days[1].stops.length, 0);
    assert.equal(model.days[0].cost, 750);
    assert.equal(model.total, 750);
    model.days[0].stops[0].note = "Changed in the export";
    assert.deepEqual(state, original);
});

test("PDF filenames retain readable international titles and remove unsafe filename characters", () => {
    assert.equal(exporter.filename("Goa / the weekend!"), "Goa-the-weekend-itinerary.pdf");
    assert.equal(exporter.filename("गोवा की यात्रा"), "गोवा-की-यात्रा-itinerary.pdf");
    assert.equal(exporter.filename("///"), "Planmate-trip-itinerary.pdf");
});

test("the exported file is a real PDF with day pages, metadata and safe clickable venue/map links", async () => {
    const bytes = await exporter.createPdf(plan(), { libraries, preview: true });
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-");
    const { PDFDocument, PDFName } = libraries.PDFLib;
    const document = await PDFDocument.load(bytes);
    assert.equal(document.getPageCount(), 3);
    assert.equal(document.getTitle(), "Goa, here we come - itinerary");
    const annotations = document.getPages()[0].node.Annots();
    assert.ok(annotations.size() >= 4);
    for (let index = 0; index < annotations.size(); index++) {
        const annotation = document.context.lookup(annotations.get(index));
        const action = annotation.lookup(PDFName.of("A"));
        const url = action.get(PDFName.of("URI")).decodeText();
        assert.equal(new URL(url).protocol, "https:");
        const rectangle = annotation
            .lookup(PDFName.of("Rect"))
            .asArray()
            .map((value) => value.asNumber());
        assert.ok(rectangle.every((value) => Number.isFinite(value) && value >= 0));
        assert.ok(rectangle[3] <= 841.89);
    }
});

test("long and multiline notes paginate, while Unicode names and an over-budget plan still export", async () => {
    const state = plan({ title: "गोवा / José 🎉", budget: 100 });
    state.stops[0].place = { ...state.stops[0].place, name: "संगीत - José’s evening" };
    state.stops[0].note = Array.from({ length: 120 }, (_, index) => String(index % 10)).join("\n");
    state.stops[1].note = "A".repeat(500);
    const bytes = await exporter.createPdf(state, { libraries });
    const document = await libraries.PDFLib.PDFDocument.load(bytes);
    assert.ok(document.getPageCount() > 3);
    assert.equal(document.getTitle(), "गोवा / José 🎉 - itinerary");
    for (const page of document.getPages()) {
        assert.equal(page.getWidth(), 595.28);
        assert.equal(page.getHeight(), 841.89);
    }
});
