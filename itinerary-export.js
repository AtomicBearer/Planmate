/* A local, shareable PDF timeline. No plan data is sent to another service. */
(function (root, factory) {
    "use strict";
    if (typeof module === "object" && module.exports)
        module.exports = factory(require("./planner-core"), root);
    else root.PlanmateExport = factory(root.PlannerCore, root);
})(typeof window === "object" ? window : globalThis, function (Core, root) {
    "use strict";
    const WIDTH = 595.28,
        HEIGHT = 841.89,
        MARGIN = 42,
        BOTTOM = 762;
    const colours = {
        paper: "#f8f5ef",
        white: "#fffdf9",
        ink: "#4e3b2c",
        brown: "#8e6f52",
        muted: "#83776c",
        line: "#ded2c3",
        sage: "#6f8060",
        sageLight: "#e4eadb",
        sand: "#eee2d2",
        terracotta: "#a86f54",
        peach: "#f2e4dc",
    };
    const categories = {
        Beach: "BEACH",
        Food: "FOOD & CAFÉS",
        Nightlife: "NIGHTLIFE",
        Sights: "SIGHTS & STORIES",
        Outdoors: "OUTDOORS",
        Event: "EVENT",
    };
    const loadedScripts = new Map();

    function loadScript(src) {
        if (loadedScripts.has(src)) return loadedScripts.get(src);
        const promise = new Promise((resolve, reject) => {
            const script = root.document.createElement("script");
            const timer = root.setTimeout(() => fail(), 20000);
            function fail() {
                root.clearTimeout(timer);
                script.remove();
                loadedScripts.delete(src);
                reject(
                    new Error(
                        "The PDF export files could not load. Refresh the page and try again.",
                    ),
                );
            }
            script.src = src;
            script.onload = () => {
                root.clearTimeout(timer);
                resolve();
            };
            script.onerror = fail;
            root.document.head.append(script);
        });
        loadedScripts.set(src, promise);
        return promise;
    }
    async function loadLibraries() {
        await loadScript("assets/vendor/regenerator-runtime.js");
        await Promise.all([
            loadScript("assets/vendor/pdf-lib.min.js"),
            loadScript("assets/vendor/fontkit.umd.min.js"),
            loadScript("assets/pdf-fonts.js"),
        ]);
        if (!root.PDFLib || !root.fontkit || !root.PlanmatePdfFonts)
            throw new Error("PDF export is unavailable. Refresh and try again.");
        return { PDFLib: root.PDFLib, fontkit: root.fontkit, fonts: root.PlanmatePdfFonts };
    }
    function filename(title) {
        const name = String(title || "Planmate trip")
            .normalize("NFKC")
            .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 80);
        return `${name || "Planmate-trip"}-itinerary.pdf`;
    }
    function buildModel(state, stops = Core.orderedStops(state)) {
        const trip = Core.validateTrip(state.trip);
        const ordered = Core.orderedStops({ stops: Core.clone(stops) }).map((stop) => ({
            ...stop,
            costKnown: stop.costKnown ?? stop.cost > 0,
        }));
        const days = Core.dates(trip.start, trip.end).map((date, index) => {
            const dayStops = ordered.filter((stop) => stop.date === date);
            return {
                date,
                number: index + 1,
                stops: dayStops,
                cost: dayStops.reduce((sum, stop) => sum + stop.cost, 0),
                unknownCosts: dayStops.filter((stop) => !stop.costKnown).length,
            };
        });
        return {
            trip,
            days,
            members: Core.clone(state.members),
            total: ordered.reduce((sum, stop) => sum + stop.cost, 0),
            unknownCosts: ordered.filter((stop) => !stop.costKnown).length,
        };
    }
    function time(value) {
        const minutes = Core.minutes(value);
        return `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${minutes < 720 ? "am" : "pm"}`;
    }
    function date(value, options) {
        return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-IN", {
            timeZone: "Asia/Kolkata",
            ...options,
        });
    }
    function mapsUrl(place) {
        return place.provider === "google"
            ? place.source
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${place.area}, ${place.city}, India`)}`;
    }
    function safeLink(value) {
        try {
            return Core.safeUrl(value);
        } catch {
            return "";
        }
    }

    async function createPdf(state, options = {}) {
        const model = buildModel(state, options.stops);
        const { PDFLib, fontkit, fonts: fontData } = options.libraries || (await loadLibraries());
        const { PDFDocument, rgb, PDFName, PDFString } = PDFLib;
        const document = await PDFDocument.create();
        document.registerFontkit(fontkit);
        document.setTitle(`${model.trip.title} - itinerary`);
        document.setAuthor("Planmate");
        document.setCreator("Planmate itinerary planner");
        document.setSubject(
            `A day-by-day plan for ${model.trip.city}. Times in ${model.trip.timezone}.`,
        );
        const fonts = {};
        for (const [name, encoded] of Object.entries(fontData)) {
            const bytes = Uint8Array.from(root.atob(encoded), (character) =>
                character.charCodeAt(0),
            );
            const font = await document.embedFont(bytes, { subset: true });
            fonts[name] = { font, characters: new Set(font.getCharacterSet()) };
        }
        const palette = Object.fromEntries(
            Object.entries(colours).map(([name, hex]) => [
                name,
                rgb(
                    ...hex
                        .slice(1)
                        .match(/../g)
                        .map((part) => parseInt(part, 16) / 255),
                ),
            ]),
        );
        const currency = new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
        });
        const money = (value) => currency.format(value);
        const segmenter =
            typeof Intl.Segmenter === "function"
                ? new Intl.Segmenter("en", { granularity: "grapheme" })
                : null;
        const graphemes = (text) =>
            segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : Array.from(text);
        // Keep complex-script clusters together; fall back to local fonts for ₹,
        // accented names, Devanagari and supported monochrome travel symbols.
        function runs(value, preferred = "body") {
            const result = [];
            const text = String(value ?? "")
                .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
                .replace(/\ufe0f/g, "")
                .replace(/[\u2010-\u2015\u2212]/g, "-");
            for (const cluster of graphemes(text)) {
                const candidates = [
                    fonts[preferred],
                    fonts.body,
                    fonts.devanagari,
                    fonts.symbols,
                    fonts.emoji,
                ].filter(Boolean);
                const selected = candidates.find((item) =>
                    Array.from(cluster).every(
                        (character) =>
                            item.characters.has(character.codePointAt(0)) ||
                            /[\u200c\u200d]/.test(character),
                    ),
                );
                const font = (selected || fonts.body).font;
                const content = selected ? cluster : "?";
                if (result.at(-1)?.font === font) result.at(-1).text += content;
                else result.push({ font, text: content });
            }
            return result;
        }
        function measure(text, size, preferred = "body") {
            return runs(text, preferred).reduce(
                (sum, run) => sum + run.font.widthOfTextAtSize(run.text, size),
                0,
            );
        }
        function wrap(value, width, size, preferred = "body") {
            const result = [];
            for (const paragraph of String(value ?? "")
                .replace(/\r\n?/g, "\n")
                .split("\n")) {
                const words = paragraph.trim().split(/\s+/).filter(Boolean);
                if (!words.length) {
                    result.push("");
                    continue;
                }
                let line = "";
                for (const word of words) {
                    const next = line ? `${line} ${word}` : word;
                    if (measure(next, size, preferred) <= width) {
                        line = next;
                        continue;
                    }
                    if (line) result.push(line);
                    line = "";
                    for (const cluster of graphemes(word)) {
                        if (line && measure(line + cluster, size, preferred) > width) {
                            result.push(line);
                            line = "";
                        }
                        line += cluster;
                    }
                }
                if (line) result.push(line);
            }
            return result;
        }
        let page, cursor, lastPoint;
        function text(value, x, top, size = 10, colour = "ink", preferred = "body") {
            for (const run of runs(value, preferred)) {
                page.drawText(run.text, {
                    x,
                    y: HEIGHT - top - size,
                    size,
                    font: run.font,
                    color: palette[colour],
                });
                x += run.font.widthOfTextAtSize(run.text, size);
            }
        }
        function textLines(lines, x, top, size, leading, colour = "ink", preferred = "body") {
            lines.forEach((line, index) =>
                text(line, x, top + index * leading, size, colour, preferred),
            );
            return top + lines.length * leading;
        }
        function line(x1, top1, x2, top2, colour = "line", thickness = 1, extra = {}) {
            page.drawLine({
                start: { x: x1, y: HEIGHT - top1 },
                end: { x: x2, y: HEIGHT - top2 },
                color: palette[colour],
                thickness,
                ...extra,
            });
        }
        function box(x, top, width, height, colour = "white", border = "line", radius = 12) {
            const r = Math.min(radius, width / 2, height / 2);
            const shape = `M${r} 0 H${width - r} Q${width} 0 ${width} ${r} V${height - r} Q${width} ${height} ${width - r} ${height} H${r} Q0 ${height} 0 ${height - r} V${r} Q0 0 ${r} 0 Z`;
            page.drawSvgPath(shape, {
                x,
                y: HEIGHT - top,
                color: palette[colour],
                borderColor: palette[border],
                borderWidth: 0.7,
            });
        }
        function star(x, top, size = 5, colour = "brown") {
            page.drawSvgPath(
                `M0 ${-size} L${size * 0.3} ${-size * 0.3} L${size} 0 L${size * 0.3} ${size * 0.3} L0 ${size} L${-size * 0.3} ${size * 0.3} L${-size} 0 L${-size * 0.3} ${-size * 0.3} Z`,
                { x, y: HEIGHT - top, color: palette[colour] },
            );
        }
        function doodle(x, top) {
            page.drawSvgPath("M0 20 L69 0 L46 51 L30 33 L0 20 M30 33 L69 0 M30 33 L24 50 L39 43", {
                x,
                y: HEIGHT - top,
                borderColor: palette.sage,
                borderWidth: 1.4,
                scale: 0.72,
            });
            page.drawSvgPath("M0 0 C-35 18 -48 55 -12 53 C12 52 19 76 -13 93", {
                x: x + 9,
                y: HEIGHT - top - 54,
                borderColor: palette.line,
                borderWidth: 1,
                dashArray: [3, 4],
                scale: 0.6,
            });
            star(x + 52, top + 66, 5, "terracotta");
            star(x + 7, top - 14, 3, "sage");
        }
        function link(label, url, x, top, size = 9) {
            url = safeLink(url);
            if (!url) return;
            text(label, x, top, size, "brown");
            const width = measure(label, size);
            line(x, top + size + 3, x + width, top + size + 3, "line", 0.6);
            const annotation = document.context.obj({
                Type: "Annot",
                Subtype: "Link",
                Rect: [x, HEIGHT - top - size - 5, x + width, HEIGHT - top + 2],
                Border: [0, 0, 0],
                A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
            });
            page.node.addAnnot(document.context.register(annotation));
        }
        function cover() {
            text("Planmate", MARGIN, 35, 25, "ink", "heading");
            star(139, 52, 5);
            text("GOOD TIMES, ON PAPER", 403, 46, 8, "muted");
            doodle(483, 111);
            let top =
                textLines(
                    wrap(model.trip.title, 415, 38, "heading"),
                    MARGIN,
                    85,
                    38,
                    43,
                    "ink",
                    "heading",
                ) + 12;
            top =
                textLines(
                    wrap(
                        `${model.trip.city}  /  ${date(model.trip.start, { day: "numeric", month: "short" })} - ${date(model.trip.end, { day: "numeric", month: "short", year: "numeric" })}`,
                        WIDTH - MARGIN * 2,
                        11,
                    ),
                    MARGIN,
                    top,
                    11,
                    16,
                    "muted",
                ) + 8;
            const names = model.members
                .slice(0, 4)
                .map((member) => member.name.trim().split(/\s+/)[0])
                .join(", ");
            const company = `${model.members.length} ${model.members.length === 1 ? "planner" : "friends"}${names ? ` / ${names}${model.members.length > 4 ? ` + ${model.members.length - 4}` : ""}` : ""}`;
            top =
                textLines(wrap(company, WIDTH - MARGIN * 2, 10), MARGIN, top, 10, 15, "sage") + 20;
            const remaining = model.trip.budget - model.total;
            const stats = [
                ["PLAN BUDGET", model.trip.budget, "sand"],
                ["PLANNED SO FAR", model.total, "sageLight"],
                [
                    remaining < 0 ? "OVER BUDGET" : "ROOM FOR MORE",
                    Math.abs(remaining),
                    remaining < 0 ? "peach" : "white",
                ],
            ];
            const width = (WIDTH - MARGIN * 2 - 20) / 3;
            stats.forEach(([label, value, colour], index) => {
                const x = MARGIN + index * (width + 10);
                box(x, top, width, 77, colour);
                text(label, x + 13, top + 11, 8, "muted");
                const amount = money(value);
                const size = Math.min(24, (width - 26) / measure(amount, 1, "heading"));
                text(
                    amount,
                    x + 13,
                    top + 25,
                    size,
                    index === 2 && remaining < 0 ? "terracotta" : "ink",
                    "heading",
                );
                text("per person · estimate", x + 13, top + 57, 8, "muted");
            });
            return top + 86;
        }
        function addPage(day, continued = false) {
            page = document.addPage([WIDTH, HEIGHT]);
            page.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, color: palette.paper });
            lastPoint = null;
            if (document.getPageCount() === 1) cursor = cover();
            else {
                text("Planmate", MARGIN, 33, 24, "ink", "heading");
                star(136, 49, 4);
                textLines(
                    wrap(model.trip.title, 365, 15, "heading"),
                    MARGIN,
                    71,
                    15,
                    19,
                    "muted",
                    "heading",
                );
                doodle(495, 42);
                cursor = 116;
            }
            box(MARGIN, cursor, WIDTH - MARGIN * 2, 58, "sageLight", "sageLight");
            text(`DAY ${String(day.number).padStart(2, "0")}`, MARGIN + 15, cursor + 11, 8, "sage");
            text(
                date(day.date, { weekday: "long", day: "numeric", month: "long" }),
                MARGIN + 15,
                cursor + 25,
                20,
                "ink",
                "heading",
            );
            const right = continued
                ? "CONTINUED"
                : `${day.stops.length} ${day.stops.length === 1 ? "STOP" : "STOPS"}`;
            text(right, WIDTH - MARGIN - 15 - measure(right, 8), cursor + 14, 8, "sage");
            const cost = `${money(day.cost)} known / person${day.unknownCosts ? " + unknown" : ""}`;
            text(cost, WIDTH - MARGIN - 15 - measure(cost, 9), cursor + 32, 9, "sage");
            cursor += 76;
        }
        function stopCard(day, stop, number) {
            const x = 161,
                width = WIDTH - MARGIN - x,
                inner = width - 32;
            const title = wrap(stop.place.name, inner, 23, "heading");
            const location = wrap(`${stop.place.area}, ${stop.place.city}`, inner, 9.5);
            const notes = stop.note ? wrap(stop.note, inner, 10) : [];
            const details = wrap(
                `Manual travel before: ${stop.travel} min  ·  ${stop.costKnown ? money(stop.cost) + " / person estimate" : "Cost unknown"}`,
                inner,
                9,
            );
            const base =
                18 +
                14 +
                title.length * 27 +
                location.length * 14 +
                13 +
                details.length * 13 +
                41 +
                (notes.length ? 21 : 0);
            let offset = 0,
                continued = false;
            do {
                const pending = notes.length - offset;
                const minimum = base + Math.min(pending, 3) * 14;
                if (cursor + minimum > BOTTOM) addPage(day, true);
                const count = Math.min(
                    pending,
                    Math.max(0, Math.floor((BOTTOM - cursor - base) / 14)),
                );
                if (pending && !count)
                    throw new Error(
                        "This stop could not fit in the PDF. Shorten its title or location and try again.",
                    );
                const height = base + count * 14;
                const point = cursor + 38;
                if (lastPoint !== null) {
                    line(140, lastPoint + 9, 140, point - 10, "sage", 1.2, { dashArray: [3, 4] });
                    line(136, point - 16, 140, point - 10, "sage", 1.1);
                    line(144, point - 16, 140, point - 10, "sage", 1.1);
                }
                page.drawCircle({
                    x: 140,
                    y: HEIGHT - point,
                    size: 9,
                    color: palette.sageLight,
                    borderColor: palette.sage,
                    borderWidth: 1,
                });
                text(String(number), 140 - measure(String(number), 8) / 2, point - 6, 8, "sage");
                text(time(stop.start), MARGIN, cursor + 23, 12, "ink");
                text(`to ${time(stop.end)}`, MARGIN, cursor + 43, 9, "muted");
                if (stop.endNextDay) text("ends next day", MARGIN, cursor + 60, 8, "terracotta");
                if (continued) text("notes continued", MARGIN, cursor + 78, 7.5, "muted");
                box(x, cursor, width, height);
                let top = cursor + 16;
                text(categories[stop.place.category] || "DISCOVERY", x + 16, top, 8, "sage");
                top += 14;
                top = textLines(title, x + 16, top, 23, 27, "ink", "heading") + 3;
                top = textLines(location, x + 16, top, 9.5, 14, "muted") + 10;
                line(x + 16, top, x + width - 16, top);
                top += 10;
                top = textLines(details, x + 16, top, 9, 13, "brown") + 10;
                if (count) {
                    text(
                        continued ? "THE REST OF THE NOTE" : "A LITTLE NOTE",
                        x + 16,
                        top,
                        7,
                        "muted",
                    );
                    top += 15;
                    top = textLines(notes.slice(offset, offset + count), x + 16, top, 10, 14) + 6;
                }
                link("Open in Google Maps", mapsUrl(stop.place), x + 16, top, 8.5);
                if (stop.place.source && stop.place.source !== mapsUrl(stop.place)) {
                    link(
                        stop.place.category === "Event" ? "Event / tickets" : "Venue / guide",
                        stop.place.source,
                        x + 203,
                        top,
                        8.5,
                    );
                }
                offset += count;
                lastPoint = point;
                cursor += height + 23;
                continued = true;
            } while (offset < notes.length);
        }
        for (const day of model.days) {
            addPage(day);
            if (!day.stops.length) {
                box(MARGIN, cursor, WIDTH - MARGIN * 2, 130);
                text(
                    "A day full of possibilities.",
                    MARGIN + 22,
                    cursor + 23,
                    27,
                    "ink",
                    "heading",
                );
                text(
                    "No stops planned yet. Keep a little room for the unexpected.",
                    MARGIN + 22,
                    cursor + 70,
                    10,
                    "muted",
                );
                text(
                    "Add your next discovery in Planmate, then export a fresh copy.",
                    MARGIN + 22,
                    cursor + 94,
                    9,
                    "sage",
                );
            }
            day.stops.forEach((stop, index) => stopCard(day, stop, index + 1));
        }
        const count = document.getPageCount();
        for (const [index, current] of document.getPages().entries()) {
            page = current;
            line(MARGIN, 786, WIDTH - MARGIN, 786);
            text(
                options.preview
                    ? `PREVIEW PLAN · SAMPLE ESTIMATES · ${model.trip.timezone}`
                    : `YOUR GROUP'S PLAN · ${model.trip.timezone}`,
                MARGIN,
                797,
                7,
                "muted",
            );
            text(
                model.unknownCosts
                    ? "Cost totals are incomplete. Unknown venue costs require checking."
                    : "Times and costs are estimates. Confirm availability with each venue.",
                MARGIN,
                811,
                7,
                "muted",
            );
            const number = `${index + 1} / ${count}`;
            text(number, WIDTH - MARGIN - measure(number, 9), 802, 9, "brown");
        }
        return document.save();
    }
    function download(bytes, title) {
        const url = root.URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        const anchor = root.document.createElement("a");
        anchor.href = url;
        anchor.download = filename(title);
        root.document.body.append(anchor);
        anchor.click();
        anchor.remove();
        root.setTimeout(() => root.URL.revokeObjectURL(url), 60000);
    }
    return Object.freeze({ createPdf, download, filename, buildModel });
});
