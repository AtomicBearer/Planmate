/* Interactive itinerary rules shared by server and browser. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.OutingRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const copy = (v) => JSON.parse(JSON.stringify(v));
    function migrate(s) {
        s.visits ||= {};
        s.reorderUndo ??= null;
        for (const p of s.proposals) p.comments ||= [];
        return s;
    }
    const fixed = (p) => p.pinned || Boolean(p.place.eventTime && p.date === p.place.eventDate);
    const clock = (m) =>
        `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    function preview(s, day, ids, C) {
        C.date(day);
        const originals = C.orderedStops(s).filter((p) => p.date === day);
        C.check(
            Array.isArray(ids) &&
                ids.length === originals.length &&
                new Set(ids).size === ids.length &&
                ids.every((id) => originals.some((p) => p.id === id)),
            "Reorder every stop on this day exactly once.",
        );
        C.check(originals.length, "This day has no stops to reorder.");
        const stops = [],
            conflicts = [];
        let cursor = Math.min(...originals.map((p) => C.minutes(p.start) - p.travel));
        for (const id of ids) {
            const old = originals.find((p) => p.id === id),
                stop = copy(old),
                duration = C.minutes(old.end) + (old.endNextDay ? 1440 : 0) - C.minutes(old.start),
                start = fixed(old) ? C.minutes(old.start) : cursor + old.travel;
            if (start - old.travel < cursor)
                conflicts.push(
                    `${old.place.name}: fixed/pinned ${old.start} cannot follow the preceding activity and travel buffer.`,
                );
            if (start < 0 || start >= 1440 || start + duration >= 2880) {
                conflicts.push(`${old.place.name}: proposed time falls outside this day.`);
                stops.push(stop);
                continue;
            }
            stop.start = clock(start);
            stop.end = clock(start + duration);
            stop.endNextDay = start + duration >= 1440;
            stops.push(stop);
            cursor = start + duration;
        }
        const candidate = { ...s, stops: [...s.stops.filter((p) => p.date !== day), ...stops] };
        for (const stop of stops) {
            try {
                C.slot(candidate, stop, stop.id);
            } catch (e) {
                conflicts.push(`${stop.place.name}: ${e.message}`);
            }
        }
        return { day, ids, stops, conflicts: [...new Set(conflicts)] };
    }
    function localNow(s, now = new Date()) {
        const parts = new Intl.DateTimeFormat("en-GB", {
                timeZone: s.trip.timezone || "Asia/Kolkata",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            }).formatToParts(now),
            get = (k) => parts.find((p) => p.type === k).value;
        return {
            date: `${get("year")}-${get("month")}-${get("day")}`,
            minutes: Number(get("hour")) * 60 + Number(get("minute")),
        };
    }
    function today(s, now = new Date(), day) {
        const current = localNow(s, now),
            date = day || current.date,
            stops = [...s.stops].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        const minute = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        const previous = new Date(`${date}T12:00:00Z`);
        previous.setUTCDate(previous.getUTCDate() - 1);
        const yesterday = previous.toISOString().slice(0, 10);
        const activities = stops.filter(
            (p) => p.date === date || (p.date === yesterday && p.endNextDay),
        );
        const next =
            date === current.date
                ? activities.find(
                      (p) =>
                          !s.visits[p.id] &&
                          (p.date === date
                              ? minute(p.end) + (p.endNextDay ? 1440 : 0) > current.minutes
                              : minute(p.end) > current.minutes),
                  )
                : null;
        const spentKnown = stops
            .filter((p) => s.visits[p.id] && p.costKnown)
            .reduce((n, p) => n + Math.round(p.cost * 100), 0);
        return {
            date,
            current,
            activities,
            next,
            spentKnown,
            unknownVisited: stops.filter((p) => s.visits[p.id] && !p.costKnown).length,
        };
    }
    function execute(s, cmd, id, C) {
        const v = cmd.payload || {},
            now = new Date().toISOString();
        switch (cmd.type) {
            case "reorderStops": {
                C.check(
                    !v.sourceStops || v.sourceStops === JSON.stringify(s.stops),
                    "The itinerary changed while previewing. Review a new timing preview.",
                );
                const p = preview(s, v.date, v.ids, C);
                C.check(!p.conflicts.length, p.conflicts.join("; "));
                s.reorderUndo = {
                    by: id,
                    before: copy(s.stops),
                    after: copy([...s.stops.filter((x) => x.date !== v.date), ...p.stops]),
                    at: now,
                };
                s.stops = copy(s.reorderUndo.after);
                return true;
            }
            case "undoReorder": {
                const u = s.reorderUndo;
                C.check(u, "No reorder is available to undo.");
                C.check(
                    u.by === id || s.organizerId === id,
                    "Only the person who reordered or the organizer can undo it.",
                );
                C.check(
                    JSON.stringify(s.stops) === JSON.stringify(u.after),
                    "The itinerary changed after reordering. Preview a new order instead.",
                );
                for (const stop of u.before) C.slot({ ...s, stops: u.before }, stop, stop.id);
                s.stops = copy(u.before);
                s.reorderUndo = null;
                return true;
            }
            case "addComment": {
                const p = s.proposals.find((x) => x.id === v.proposalId);
                C.check(p, "Suggestion no longer exists.");
                C.check(p.comments.length < 100, "This suggestion has reached 100 comments.");
                const commentId = C.text(v.id, "Comment ID", 100);
                C.check(!p.comments.some((c) => c.id === commentId), "Comment already exists.");
                p.comments.push({
                    id: commentId,
                    by: id,
                    text: C.text(v.text, "Comment", 1000),
                    createdAt: now,
                    updatedAt: null,
                });
                return true;
            }
            case "editComment":
            case "deleteComment": {
                const p = s.proposals.find((x) => x.id === v.proposalId),
                    c = p?.comments.find((x) => x.id === v.id);
                C.check(c, "Comment no longer exists.");
                C.check(c.by === id, "Only the author can edit or delete this comment.");
                if (cmd.type === "deleteComment")
                    p.comments = p.comments.filter((x) => x.id !== c.id);
                else {
                    c.text = C.text(v.text, "Comment", 1000);
                    c.updatedAt = now;
                }
                return true;
            }
            case "markVisited":
                C.check(
                    s.stops.some((p) => p.id === v.id),
                    "Stop no longer exists.",
                );
                C.check(
                    v.visited || !s.scrapbook.some((p) => p.stopId === v.id),
                    "Keep this visit recorded while scrapbook photos are attached. Photo authors can remove their uploads first.",
                );
                if (v.visited) s.visits[v.id] = { by: id, at: now };
                else delete s.visits[v.id];
                return true;
            case "setCoordinates": {
                const stop = s.stops.find((p) => p.id === v.id);
                C.check(stop, "Stop no longer exists.");
                C.check(
                    stop.place.provider !== "google",
                    "Refresh Google's current location instead of storing its coordinates.",
                );
                const coordinates = v.coordinates
                    ? {
                          latitude: C.number(v.coordinates.latitude, "Latitude", -90, 90),
                          longitude: C.number(v.coordinates.longitude, "Longitude", -180, 180),
                          source: C.safeUrl(v.coordinates.source),
                      }
                    : null;
                C.check(!coordinates || coordinates.source, "Add a source link for the location.");
                if (coordinates) stop.place.coordinates = coordinates;
                else delete stop.place.coordinates;
                const p = s.proposals.find((p) => p.id === stop.proposalId);
                if (p) {
                    if (coordinates) p.place.coordinates = copy(coordinates);
                    else delete p.place.coordinates;
                }
                return true;
            }
            default:
                return false;
        }
    }
    return { migrate, preview, localNow, today, execute, fixed };
});
