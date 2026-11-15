/* Manual Indian rail journeys. No timetable, ticket or live-status claims. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.TrainRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const stamp = (date, time) => Date.parse(date + "T" + time + ":00Z") / 60000;
    function interval(leg) {
        return leg.status !== "cancelled" && leg.departureTime && leg.arrivalTime
            ? [stamp(leg.departureDate, leg.departureTime), stamp(leg.arrivalDate, leg.arrivalTime)]
            : null;
    }
    function validate(value, C) {
        const leg = {
            id: C.text(value.id, "Journey ID", 100),
            from: C.text(value.from, "Departure station", 100),
            to: C.text(value.to, "Arrival station", 100),
            departureDate: C.date(value.departureDate),
            arrivalDate: C.date(value.arrivalDate),
            departureTime: value.departureTime || "",
            arrivalTime: value.arrivalTime || "",
            train: C.text(value.train || "", "Train name / number", 100, false),
            status: value.status || "tentative",
            note: C.text(value.note || "", "Journey note", 500, false),
        };
        C.check(
            ["tentative", "booked", "cancelled"].includes(leg.status),
            "Choose a booking status.",
        );
        C.check(leg.from.toLowerCase() !== leg.to.toLowerCase(), "Choose different stations.");
        C.dates(leg.departureDate, leg.arrivalDate);
        if (leg.departureTime) C.minutes(leg.departureTime);
        if (leg.arrivalTime) C.minutes(leg.arrivalTime);
        if (leg.departureTime && leg.arrivalTime)
            C.check(
                stamp(leg.arrivalDate, leg.arrivalTime) >
                    stamp(leg.departureDate, leg.departureTime),
                "Arrival must follow departure. Choose the next date for an overnight train.",
            );
        return leg;
    }
    function overlaps(a, b) {
        return a[0] < b[1] && b[0] < a[1];
    }
    function validateSchedule(state, C) {
        if (state.journeys?.some((leg) => leg.status !== "cancelled"))
            C.check(
                ["Asia/Kolkata", "Asia/Calcutta"].includes(state.trip.timezone),
                "Use the Asia/Kolkata trip timezone for Indian train journeys.",
            );
        const legs = (state.journeys || []).filter((leg) => interval(leg));
        for (let i = 0; i < legs.length; i++) {
            const range = interval(legs[i]);
            for (const other of legs.slice(i + 1))
                C.check(
                    !overlaps(range, interval(other)),
                    "Train journeys overlap. Adjust their dates or times.",
                );
            for (const stop of state.stops) {
                const stopRange = [
                    stamp(stop.date, stop.start) - (stop.travel || 0),
                    stamp(stop.date, stop.end) + (stop.endNextDay ? 1440 : 0),
                ];
                C.check(
                    !overlaps(range, stopRange),
                    "A train journey overlaps " +
                        stop.place.name +
                        " or its travel buffer. Adjust the times first.",
                );
            }
        }
    }
    function execute(state, command, memberId, C) {
        if (!["addJourney", "editJourney", "removeJourney"].includes(command.type)) return false;
        const value = command.payload || {};
        state.journeys ||= [];
        const previous = state.journeys.find((leg) => leg.id === value.id);
        if (command.type === "addJourney") {
            C.check(state.journeys.length < 50, "This trip has reached 50 journeys.");
            C.check(!previous, "This journey already exists.");
            state.journeys.push({ ...validate(value, C), by: memberId });
        } else {
            C.check(previous, "This journey no longer exists.");
            C.check(
                previous.by === memberId || state.organizerId === memberId,
                "Only the person who added this journey or the organizer can change it.",
            );
            if (command.type === "removeJourney")
                state.journeys = state.journeys.filter((leg) => leg.id !== value.id);
            else Object.assign(previous, validate(value, C));
        }
        validateSchedule(state, C);
        return true;
    }
    return { validate, interval, validateSchedule, execute };
});
