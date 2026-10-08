/* Civil dates and clocks in the trip timezone, never the browser's local timezone.
   These intervals compare planning clocks; they are not elapsed-time route data. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.PlanningTime = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const minute = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
    const day = (date) => Date.parse(`${date}T00:00:00Z`) / 60000;
    const dateAt = (value) =>
        new Date(Math.floor(value / 1440) * 86400000).toISOString().slice(0, 10);
    const clock = (value) => {
        const m = ((value % 1440) + 1440) % 1440;
        return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };
    const interval = (value, travel = 0) => [
        day(value.date) + minute(value.start) - travel,
        day(value.date) + minute(value.end) + (value.endNextDay ? 1440 : 0),
    ];
    function merge(ranges) {
        const merged = [];
        for (const range of ranges.map((r) => [...r]).sort((a, b) => a[0] - b[0])) {
            const last = merged[merged.length - 1];
            if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
            else merged.push(range);
        }
        return merged;
    }
    function intersect(a, b) {
        return merge(
            a.flatMap((x) =>
                b
                    .map((y) => [Math.max(x[0], y[0]), Math.min(x[1], y[1])])
                    .filter((r) => r[0] < r[1]),
            ),
        );
    }
    const covers = (ranges, [start, end]) => ranges.some((r) => r[0] <= start && r[1] >= end);
    function windowValue([start, end]) {
        const date = dateAt(start);
        return {
            date,
            start: clock(start),
            end: clock(end),
            ...(dateAt(end) !== date ? { endNextDay: true } : {}),
        };
    }
    const label = (o) =>
        `${o.date} ${o.start}–${o.end}${o.endNextDay ? ` (+1 day, ${dateAt(interval(o)[1])})` : ""}`;
    function windows(ranges) {
        const values = [];
        for (const [start, end] of ranges)
            for (let cursor = start; cursor < end; cursor += 1440)
                values.push(windowValue([cursor, Math.min(cursor + 1440, end)]));
        return values;
    }
    return {
        minute,
        day,
        dateAt,
        clock,
        interval,
        merge,
        intersect,
        covers,
        windowValue,
        windows,
        label,
    };
});
