/* Shared planning rules, used by both the browser and the local server. */
(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory(
            require("./planning-rules.js"),
            require("./train-rules.js"),
            require("./chikkamagaluru.js"),
        );
    else root.PlannerCore = factory(root.PlanningRules, root.TrainRules, root.Chikkamagaluru);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Rules, Trains, Region) {
    "use strict";
    const categories = ["Beach", "Food", "Nightlife", "Sights", "Outdoors", "Event"];
    const clone = (value) => JSON.parse(JSON.stringify(value));
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    function text(value, label, max = 240, required = true) {
        check(typeof value === "string", `${label} is required.`);
        const result = value.trim();
        check(
            (!required || result.length > 0) && result.length <= max,
            `${label} must be ${required ? "1" : "0"}–${max} characters.`,
        );
        return result;
    }
    function number(value, label, min, max) {
        check(
            typeof value === "number" && Number.isFinite(value) && value >= min && value <= max,
            `${label} must be between ${min} and ${max}.`,
        );
        return value;
    }
    function date(value) {
        check(
            typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
            "Choose a valid date.",
        );
        const parsed = new Date(`${value}T12:00:00Z`);
        check(
            !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
            "Choose a valid date.",
        );
        return value;
    }
    function dates(start, end) {
        date(start);
        date(end);
        check(start <= end, "The end date must be on or after the start date.");
        check((new Date(end) - new Date(start)) / 86400000 < 31, "Plan up to 31 days at a time.");
        const days = [];
        for (
            let d = new Date(`${start}T12:00:00Z`);
            d.toISOString().slice(0, 10) <= end;
            d.setUTCDate(d.getUTCDate() + 1)
        )
            days.push(d.toISOString().slice(0, 10));
        return days;
    }
    function minutes(value) {
        check(
            typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
            "Choose a valid start and end time.",
        );
        return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    }
    function safeUrl(value) {
        if (!value) return "";
        text(value, "Link", 1500);
        let url;
        try {
            url = new URL(value);
        } catch {
            throw new Error("Use a complete https:// link.");
        }
        check(["http:", "https:"].includes(url.protocol), "Use an http:// or https:// link.");
        return url.href;
    }
    function place(value) {
        check(value && typeof value === "object", "Choose a place or event.");
        check(categories.includes(value.category), "Choose a valid category.");
        const result = {
            id: text(value.id, "Place ID", 100),
            name: text(value.name, "Place name", 100),
            city: canonicalCity(text(value.city, "City", 60)),
            area: text(value.area || value.city, "Area", 100),
            category: value.category,
            description: text(
                value.description || "A place suggested by your group.",
                "Description",
                500,
            ),
            duration: number(value.duration ?? 90, "Suggested duration", 15, 720),
            source: safeUrl(value.source || ""),
            custom: Boolean(value.custom),
        };
        const regional = Region.places.find((p) => p.id === result.id);
        if (regional) return clone(regional);
        if (value.provider) result.provider = text(value.provider, "Provider", 40);
        if (value.provider === "google") {
            check(/^google-[A-Za-z0-9_-]{1,80}$/.test(result.id), "Choose a valid Google place.");
            // Store a reference and the user's planning choices, never the
            // provider's photo resources, addresses or descriptive content.
            result.name = value.label
                ? text(value.label, "Your place label", 100)
                : "Saved Google Maps place";
            if (value.label) result.label = result.name;
            result.area = result.city;
            result.description = "Refresh this saved place to see its current details and photo.";
            result.source = `https://www.google.com/maps/search/?api=1&query=place&query_place_id=${encodeURIComponent(result.id.slice(7))}`;
        }
        if (value.coordinates && value.provider !== "google") {
            result.coordinates = {
                latitude: number(value.coordinates.latitude, "Latitude", -90, 90),
                longitude: number(value.coordinates.longitude, "Longitude", -180, 180),
                source: safeUrl(value.coordinates.source),
            };
            check(result.coordinates.source, "Supply a source for this location.");
        }
        if (value.eventDate) {
            check(result.category === "Event", "Event dates need the Event category.");
            result.eventDate = date(value.eventDate);
            result.eventEndDate = value.eventEndDate ? date(value.eventEndDate) : result.eventDate;
            check(
                result.eventEndDate >= result.eventDate,
                "Event end date must follow its start date.",
            );
            if (value.eventTime) {
                minutes(value.eventTime);
                result.eventTime = value.eventTime;
            }
            if (value.eventType) result.eventType = text(value.eventType, "Event type", 40);
            if (value.imageUrl) {
                result.imageUrl = safeUrl(value.imageUrl);
                check(result.imageUrl.startsWith("https://"), "Use an https:// image link.");
            }
            if (value.imageCredit)
                result.imageCredit = text(value.imageCredit, "Image credit", 120);
        }
        return result;
    }
    function slot(state, value, ignoreId) {
        const result = {
            date: date(value.date),
            start: value.start,
            end: value.end,
            endNextDay: Boolean(value.endNextDay),
            travel: number(value.travel ?? 0, "Travel buffer", 0, 240),
            cost: number(
                value.costKnown === false ? 0 : (value.cost ?? 0),
                "Estimated cost per person",
                0,
                1000000,
            ),
            costKnown: value.costKnown ?? value.cost !== undefined,
            travelKnown: value.travelKnown ?? value.travel !== undefined,
            note: text(value.note || "", "Note", 500, false),
        };
        check(
            dates(state.trip.start, state.trip.end).includes(result.date),
            "Choose a day within your trip dates.",
        );
        const start = minutes(result.start);
        const end = minutes(result.end) + (result.endNextDay ? 1440 : 0);
        check(
            end > start && end - start <= 1440,
            "End time must follow start time. Select ‘Ends next day’ for overnight stops.",
        );
        const base = Math.floor(new Date(`${result.date}T00:00:00Z`).getTime() / 60000);
        const interval = [base + start - result.travel, base + end];
        for (const stop of state.stops.filter((item) => item.id !== ignoreId)) {
            const otherBase = Math.floor(new Date(`${stop.date}T00:00:00Z`).getTime() / 60000);
            const other = [
                otherBase + minutes(stop.start) - stop.travel,
                otherBase + minutes(stop.end) + (stop.endNextDay ? 1440 : 0),
            ];
            check(
                interval[0] >= other[1] || interval[1] <= other[0],
                `This overlaps ${stop.place.name} or its travel buffer. Adjust the time or day.`,
            );
        }
        return result;
    }
    function apply(original, command, memberId) {
        check(original && original.version === 1, "This plan format is not supported.");
        check(command && typeof command === "object", "Choose an action.");
        const state = Rules.migrate(original);
        const before = Rules.fingerprint(state);
        check(
            state.members.some((member) => member.id === memberId && !member.removed),
            "Join the group before making changes.",
        );
        const value = command.payload || {};
        switch (command.type) {
            case "propose": {
                check(state.proposals.length < 500, "This plan has reached 500 ideas.");
                const item = place(value.place);
                check(
                    !state.proposals.some((p) => p.place.id === item.id && p.status === "pending"),
                    "This place is already on the ideas board. Vote for it there.",
                );
                const id = text(value.id, "Idea ID", 100);
                check(!state.proposals.some((p) => p.id === id), "This idea already exists.");
                const preferredDate = value.preferredDate
                    ? date(value.preferredDate)
                    : item.eventDate
                      ? item.eventDate < state.trip.start
                          ? state.trip.start
                          : item.eventDate
                      : "";
                check(
                    !preferredDate ||
                        dates(state.trip.start, state.trip.end).includes(preferredDate),
                    "The suggested day must be within the trip.",
                );
                check(
                    !item.eventDate ||
                        (preferredDate >= item.eventDate && preferredDate <= item.eventEndDate),
                    "Choose a day during the event's actual dates.",
                );
                state.proposals.push({
                    id,
                    place: item,
                    by: memberId,
                    note: text(value.note || "", "Note", 500, false),
                    preferredDate,
                    votes: [memberId],
                    responses: { [memberId]: "interested" },
                    comments: [],
                    estimate: { costPaise: null, travel: null },
                    status: "pending",
                    createdAt: new Date().toISOString(),
                });
                break;
            }
            case "vote": {
                const idea = state.proposals.find(
                    (p) => p.id === value.id && p.status === "pending",
                );
                check(idea, "This idea is no longer awaiting votes.");
                idea.votes = idea.votes.includes(memberId)
                    ? idea.votes.filter((id) => id !== memberId)
                    : [...idea.votes, memberId];
                if (idea.votes.includes(memberId)) idea.responses[memberId] = "interested";
                else delete idea.responses[memberId];
                break;
            }
            case "schedule": {
                check(state.stops.length < 500, "This itinerary has reached 500 stops.");
                const idea = state.proposals.find(
                    (p) => p.id === value.proposalId && p.status === "pending",
                );
                check(idea, "This idea has already been scheduled or removed.");
                const id = text(value.id, "Stop ID", 100);
                check(!state.stops.some((s) => s.id === id), "This stop already exists.");
                check(
                    !idea.place.eventDate ||
                        (value.date >= idea.place.eventDate &&
                            value.date <= idea.place.eventEndDate),
                    "Schedule this event during its actual dates.",
                );
                check(
                    !idea.place.eventTime ||
                        value.date !== idea.place.eventDate ||
                        value.start === idea.place.eventTime,
                    "Use the event's published start time.",
                );
                state.stops.push({
                    ...slot(state, value),
                    pinned: false,
                    id,
                    place: clone(idea.place),
                    proposalId: idea.id,
                    by: memberId,
                });
                idea.status = "scheduled";
                break;
            }
            case "editStop": {
                const stop = state.stops.find((s) => s.id === value.id);
                check(stop, "This stop no longer exists.");
                check(
                    !stop.pinned || state.organizerId === memberId,
                    "Only the organizer can edit a pinned stop.",
                );
                check(
                    !stop.place.eventDate ||
                        (value.date >= stop.place.eventDate &&
                            value.date <= stop.place.eventEndDate),
                    "Schedule this event during its actual dates.",
                );
                check(
                    !stop.place.eventTime ||
                        value.date !== stop.place.eventDate ||
                        value.start === stop.place.eventTime,
                    "Use the event's published start time.",
                );
                Object.assign(stop, slot(state, value, stop.id));
                break;
            }
            case "removeStop": {
                const stop = state.stops.find((s) => s.id === value.id);
                check(stop, "This stop no longer exists.");
                check(
                    !state.scrapbook.some((p) => p.stopId === stop.id),
                    "This stop has scrapbook memories. Keep it in the itinerary, or ask photo authors to remove their uploads first.",
                );
                check(
                    !stop.pinned || state.organizerId === memberId,
                    "Only the organizer can remove a pinned stop.",
                );
                state.stops = state.stops.filter((s) => s.id !== stop.id);
                delete state.visits[stop.id];
                const idea = state.proposals.find((p) => p.id === stop.proposalId);
                if (idea) idea.status = "pending";
                break;
            }
            case "removeIdea": {
                const idea = state.proposals.find(
                    (p) => p.id === value.id && p.status === "pending",
                );
                check(idea, "This idea cannot be removed while it is scheduled.");
                check(idea.by === memberId, "Only the person who proposed an idea can remove it.");
                state.proposals = state.proposals.filter((p) => p.id !== idea.id);
                break;
            }
            case "updateMember": {
                const member = state.members.find((m) => m.id === memberId);
                member.name = text(value.name, "Display name", 60);
                break;
            }
            case "updateTrip": {
                Rules.organizer(state, memberId, api);
                const trip = validateTrip({
                    ...value,
                    timezone: value.timezone ?? state.trip.timezone,
                });
                const conflicts = Rules.dateConflicts(state, trip.start, trip.end);
                check(
                    !conflicts.length,
                    `Move or remove affected activities before changing dates: ${conflicts.join("; ")}.`,
                );
                if (state.availability.chosen?.date !== trip.start)
                    state.availability.chosen = null;
                else if (state.availability.chosen)
                    check(
                        trip.end >=
                            Rules.time.dateAt(Rules.time.interval(state.availability.chosen)[1]),
                        "The chosen availability window ends after these trip dates. Include its ending day or choose another final window first.",
                    );
                state.trip = trip;
                break;
            }
            default:
                check(
                    Trains.execute(state, command, memberId, api) ||
                        Rules.execute(state, command, memberId, api),
                    "Unknown planning action.",
                );
        }
        Trains.validateSchedule(state, api);
        Rules.finish(state, before);
        state.revision += 1;
        state.updatedAt = new Date().toISOString();
        return state;
    }
    function validateTrip(value) {
        check(value && typeof value === "object", "Enter trip details.");
        dates(value.start, value.end);
        return {
            title: text(value.title, "Trip name", 100),
            city: canonicalCity(text(value.city, "City", 60)),
            start: value.start,
            end: value.end,
            budget: number(value.budget ?? 5000, "Budget per person", 0, 1000000),
            timezone: validateTimezone(value.timezone || "Asia/Kolkata"),
        };
    }
    function createState(trip, member) {
        return Rules.migrate({
            version: 1,
            revision: 0,
            trip: validateTrip(trip),
            members: [
                { id: text(member.id, "Member ID", 100), name: text(member.name, "Name", 60) },
            ],
            proposals: [],
            stops: [],
            updatedAt: new Date().toISOString(),
        });
    }
    function orderedStops(state) {
        return [...state.stops].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    }
    function validateTimezone(value) {
        text(value, "Timezone", 80);
        try {
            new Intl.DateTimeFormat("en", { timeZone: value }).format();
        } catch {
            throw new Error("Choose a valid timezone.");
        }
        return value;
    }
    function canonicalCity(city) {
        return [Region.city, ...Region.aliases].some(
            (alias) => alias.toLowerCase() === city.trim().toLowerCase(),
        )
            ? Region.city
            : city;
    }
    const api = {
        canonicalCity,
        trains: Trains,
        categories,
        clone,
        check,
        text,
        number,
        date,
        dates,
        minutes,
        safeUrl,
        place,
        slot,
        apply,
        validateTrip,
        createState,
        orderedStops,
        migrate: Rules.migrate,
        agreement: Rules,
    };
    return api;
});
