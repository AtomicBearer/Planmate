/* Backward-compatible shared agreement rules. No provider or browser dependencies. */
(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory(
            require("./group-fit.js"),
            require("./outing-rules.js"),
            require("./expense-rules.js"),
            require("./planning-time.js"),
        );
    else
        root.PlanningRules = factory(
            root.GroupFit,
            root.OutingRules,
            root.ExpenseRules,
            root.PlanningTime,
        );
})(typeof globalThis !== "undefined" ? globalThis : this, function (Fit, Outing, Money, Time) {
    "use strict";
    const copy = (v) => JSON.parse(JSON.stringify(v));
    function migrate(original) {
        const s = copy(original);
        s.featuresVersion = 2;
        s.journeys ||= [];
        s.organizerId ||= s.members[0]?.id;
        s.trip.timezone ||= "Asia/Kolkata";
        s.materialVersion ??= 0;
        s.availability ||= { options: [], responses: {}, chosen: null };
        for (const option of s.availability.options) option.endNextDay ??= false;
        if (s.availability.chosen) s.availability.chosen.endNextDay ??= false;
        s.attendance ||= {};
        s.confirmation ??= null;
        for (const p of s.proposals) {
            p.responses ||= Object.fromEntries((p.votes || []).map((id) => [id, "interested"]));
            p.votes = Object.keys(p.responses).filter((id) => p.responses[id] === "interested");
        }
        return Money.migrate(Outing.migrate(Fit.migrate(s)));
    }
    function organizer(s, id, C) {
        C.check(s.organizerId === id, "Only the organizer can do this.");
    }
    function fingerprint(s) {
        return JSON.stringify([
            s.members.filter((m) => !m.removed).map((m) => m.id),
            [s.trip.city, s.trip.start, s.trip.end, s.trip.budget, s.trip.timezone],
            s.availability.chosen,
            [...(s.journeys || [])].sort((a, b) => a.id.localeCompare(b.id)),
            [...s.stops]
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((p) => [
                    p.id,
                    p.place.id,
                    p.place.coordinates,
                    p.date,
                    p.start,
                    p.end,
                    p.endNextDay,
                    p.cost,
                    p.costKnown,
                    p.travel,
                    p.travelKnown,
                    p.note,
                ]),
        ]);
    }
    function dateConflicts(s, start, end) {
        return [
            ...s.stops
                .filter((p) => p.date < start || p.date > end)
                .map((p) => `${p.place.name} is scheduled on ${p.date}`),
            ...s.proposals
                .filter(
                    (p) => p.preferredDate && (p.preferredDate < start || p.preferredDate > end),
                )
                .map((p) => `${p.place.name} has preferred day ${p.preferredDate}`),
        ];
    }
    function progress(s, memberId) {
        const missing = s.members
            .filter((m) => !m.removed)
            .filter((m) => !Object.hasOwn(s.availability.responses, m.id));
        const inMembers = s.members
            .filter((m) => !m.removed)
            .filter(
                (m) =>
                    s.attendance[m.id]?.response === "in" &&
                    (!s.confirmation || s.attendance[m.id].version === s.materialVersion),
            );
        const reconfirm = s.members
            .filter((m) => !m.removed)
            .filter(
                (m) =>
                    s.confirmation &&
                    s.attendance[m.id]?.response === "in" &&
                    s.attendance[m.id].version !== s.materialVersion,
            );
        const unanswered = s.members.filter((m) => !m.removed).filter((m) => !s.attendance[m.id]);
        const stage =
            s.confirmation && !s.confirmation.needsReview
                ? "Confirmed"
                : !s.availability.chosen
                  ? "Choosing a date"
                  : !s.stops.length
                    ? "Shortlisting"
                    : "Scheduling";
        let next, nextView, nextLabel;
        if (!s.availability.chosen) {
            nextView = "group";
            if (!s.availability.options.length) {
                next = "Organizer: propose dates and time windows for the group";
                nextLabel = "Propose dates";
            } else if (missing.length) {
                next = `${missing.length} friend(s) haven't answered the date poll`;
                nextLabel = "Answer the date poll";
            } else {
                next = "Organizer: choose the final date";
                nextLabel = "Choose the final date";
            }
        } else if (!s.proposals.length && !s.stops.length) {
            next = "Suggest places that suit your group";
            nextView = "discover";
            nextLabel = "Explore places";
        } else if (!s.stops.length) {
            next = "Give your shortlisted ideas a time";
            nextView = "ideas";
            nextLabel = "Schedule your ideas";
        } else if (reconfirm.length) {
            next = `${reconfirm.length} friend(s) need to reconfirm attendance`;
            nextView = "group";
            nextLabel = "Review attendance";
        } else if (unanswered.length) {
            next = `${unanswered.length} friend(s) haven't answered attendance`;
            nextView = "group";
            nextLabel = "Answer attendance";
        } else if (stage === "Confirmed") {
            next = "Your agreed plan is recorded; later edits remain possible";
            nextView = "today";
            nextLabel = "Open today's plan";
        } else {
            next = "Organizer: review and confirm the plan";
            nextView = "group";
            nextLabel = "Review and confirm";
        }
        if (memberId) {
            const host = s.organizerId === memberId;
            if (
                s.availability.options.length &&
                !Object.hasOwn(s.availability.responses, memberId) &&
                !s.availability.chosen
            ) {
                next = "Tell the group which date windows work for you";
                nextView = "group";
                nextLabel = "Answer my availability";
            } else if (!s.availability.chosen && !host) {
                next =
                    "The organizer will choose the date; share what would make this trip work for you";
                nextView = s.preferences[memberId] ? "ideas" : "fit";
                nextLabel = s.preferences[memberId] ? "Review group ideas" : "Share my preferences";
            } else if (s.availability.chosen && !s.preferences[memberId] && stage !== "Confirmed") {
                next = "Share your interests, pace and budget for this trip";
                nextView = "fit";
                nextLabel = "Share my preferences";
            } else if (
                s.stops.length &&
                (!s.attendance[memberId] || reconfirm.some((m) => m.id === memberId))
            ) {
                next = reconfirm.some((m) => m.id === memberId)
                    ? "The plan changed. Review it and reconfirm your attendance"
                    : "Review the itinerary and tell the group whether you're coming";
                nextView = "group";
                nextLabel = "Answer my attendance";
            } else if (!host && stage === "Scheduling" && !reconfirm.length && !unanswered.length) {
                next = "The organizer will confirm the plan. Review the scheduled stops together";
                nextView = "itinerary";
                nextLabel = "Review the itinerary";
            }
        }
        return { stage, next, nextView, nextLabel, missing, inMembers, reconfirm, unanswered };
    }
    function availabilitySummary(s) {
        const responses = s.availability.responses;
        return s.availability.options.map((o) => {
            const available = s.members
                .filter((m) => !m.removed)
                .filter((m) => responses[m.id]?.includes(o.id));
            return {
                ...o,
                available,
                common:
                    available.length === s.members.filter((m) => !m.removed).length &&
                    s.members.filter((m) => !m.removed).length > 0,
            };
        });
    }
    function commonWindows(s) {
        if (
            !s.members.filter((m) => !m.removed).length ||
            s.members
                .filter((m) => !m.removed)
                .some((m) => !Object.hasOwn(s.availability.responses, m.id))
        )
            return [];
        let windows = Time.merge(s.availability.options.map((o) => Time.interval(o)));
        for (const member of s.members.filter((m) => !m.removed)) {
            const ranges = Time.merge(
                s.availability.options
                    .filter((o) => s.availability.responses[member.id].includes(o.id))
                    .map((o) => Time.interval(o)),
            );
            windows = Time.intersect(windows, ranges);
        }
        return Time.windows(windows);
    }
    function execute(s, command, id, C) {
        const v = command.payload || {},
            now = new Date().toISOString();
        switch (command.type) {
            case "transferOrganizer": {
                organizer(s, id, C);
                C.check(
                    s.members.some((m) => m.id === v.memberId && !m.removed && m.id !== id),
                    "Choose another active trip member.",
                );
                s.organizerId = v.memberId;
                return true;
            }
            case "removeMember":
            case "leaveTrip": {
                const target = command.type === "leaveTrip" ? id : v.memberId;
                if (command.type === "removeMember") organizer(s, id, C);
                C.check(
                    target !== s.organizerId,
                    "Transfer organizer responsibilities before the organizer leaves.",
                );
                const member = s.members.find((m) => m.id === target && !m.removed);
                C.check(member, "This member is no longer active.");
                member.removed = true;
                member.removedAt = now;
                return true;
            }
            case "addAvailability": {
                organizer(s, id, C);
                C.check(s.availability.options.length < 30, "Use up to 30 date options.");
                const option = {
                    id: C.text(v.id, "Option ID", 100),
                    date: C.date(v.date),
                    start: v.start,
                    end: v.end,
                    endNextDay: v.endNextDay ?? false,
                };
                C.check(
                    typeof option.endNextDay === "boolean",
                    "Choose whether the window ends next day.",
                );
                const duration =
                    C.minutes(option.end) +
                    (option.endNextDay ? 1440 : 0) -
                    C.minutes(option.start);
                C.check(
                    duration > 0 && duration <= 1440,
                    "The window must last up to 24 hours. Select ‘Ends next day’ when it crosses midnight.",
                );
                C.check(
                    !s.availability.options.some(
                        (o) =>
                            o.id === option.id ||
                            (o.date === option.date &&
                                o.start === option.start &&
                                o.end === option.end &&
                                o.endNextDay === option.endNextDay),
                    ),
                    "That availability option already exists.",
                );
                s.availability.options.push(option);
                // Adding an option requires every member to review the updated poll.
                s.availability.responses = {};
                return true;
            }
            case "removeAvailability":
                organizer(s, id, C);
                C.check(
                    s.availability.options.some((o) => o.id === v.id),
                    "This option no longer exists.",
                );
                C.check(
                    s.availability.chosen?.id !== v.id,
                    "Choose another final date before removing this option.",
                );
                s.availability.options = s.availability.options.filter((o) => o.id !== v.id);
                for (const key of Object.keys(s.availability.responses))
                    s.availability.responses[key] = s.availability.responses[key].filter(
                        (x) => x !== v.id,
                    );
                return true;
            case "respondAvailability":
                C.check(
                    Array.isArray(v.options) &&
                        v.options.every((x) => s.availability.options.some((o) => o.id === x)),
                    "Choose options from the current poll.",
                );
                s.availability.responses[id] = [...new Set(v.options)];
                return true;
            case "chooseAvailability": {
                organizer(s, id, C);
                const option = s.availability.options.find((o) => o.id === v.id);
                C.check(option, "Choose an existing date option.");
                const endingDay = Time.dateAt(Time.interval(option)[1]);
                const end = C.date(v.endDate || endingDay);
                C.check(
                    end >= endingDay,
                    "The trip end date must include the overnight availability window.",
                );
                C.dates(option.date, end);
                const conflicts = dateConflicts(s, option.date, end);
                C.check(
                    !conflicts.length,
                    `Move or remove affected activities before changing dates: ${conflicts.join("; ")}.`,
                );
                s.trip.start = option.date;
                s.trip.end = end;
                s.availability.chosen = copy(option);
                return true;
            }
            case "respondAttendance":
                C.check(
                    ["in", "maybe", "out"].includes(v.response),
                    "Choose I'm in, Maybe or Can't make it.",
                );
                s.attendance[id] = {
                    response: v.response,
                    version: s.materialVersion,
                    updatedAt: now,
                };
                return true;
            case "respondSuggestion": {
                const idea = s.proposals.find((p) => p.id === v.id);
                C.check(idea, "This suggestion no longer exists.");
                C.check(
                    ["interested", "maybe", "pass", ""].includes(v.response),
                    "Choose Interested, Maybe or Pass.",
                );
                if (v.response) idea.responses[id] = v.response;
                else delete idea.responses[id];
                idea.votes = Object.keys(idea.responses).filter(
                    (key) => idea.responses[key] === "interested",
                );
                return true;
            }
            case "confirmPlan":
                organizer(s, id, C);
                C.check(s.availability.chosen, "Choose the final date before confirming.");
                C.check(s.stops.length, "Schedule at least one activity before confirming.");
                // Initial attendance is intent to join the trip. Establish its baseline
                // when the organizer first records a plan; later changes need reconfirmation.
                if (!s.confirmation)
                    for (const response of Object.values(s.attendance))
                        if (response.response === "in") response.version = s.materialVersion;
                s.confirmation = {
                    by: id,
                    at: now,
                    revision: s.revision + 1,
                    materialVersion: s.materialVersion,
                    needsReview: false,
                    snapshot: { trip: copy(s.trip), stops: copy(s.stops) },
                };
                return true;
            default:
                return (
                    Fit.execute(s, command, id, C) ||
                    Outing.execute(s, command, id, C) ||
                    Money.execute(s, command, id, C)
                );
        }
    }
    function finish(s, before) {
        if (fingerprint(s) !== before) {
            s.materialVersion += 1;
            if (s.confirmation) s.confirmation.needsReview = true;
        }
    }
    return {
        migrate,
        organizer,
        fingerprint,
        dateConflicts,
        progress,
        availabilitySummary,
        commonWindows,
        execute,
        finish,
        fit: Fit,
        outing: Outing,
        money: Money,
        time: Time,
    };
});
