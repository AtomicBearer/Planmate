/* Transparent group-fit scoring and draft generation. All money here is estimates. */
(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory(require("./planning-time"));
    else root.GroupFit = factory(root.PlanningTime);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Time) {
    "use strict";
    const copy = (v) => JSON.parse(JSON.stringify(v));
    const members = (s) =>
        s.members.filter((m) => !m.removed && s.attendance[m.id]?.response !== "out");
    const knownCost = (p) => p.estimate?.costPaise ?? null;
    function inputs(s) {
        return JSON.stringify([
            s.members.map((m) => [m.id, m.name, Boolean(m.removed)]),
            s.trip,
            s.preferences,
            s.availability,
            s.attendance,
            s.proposals.map((p) => [
                p.id,
                p.place,
                p.note,
                p.estimate,
                p.responses,
                p.preferredDate,
            ]),
            s.stops.map((p) => [p.id, p.pinned]),
        ]);
    }
    function migrate(s) {
        s.preferences ||= {};
        for (const p of Object.values(s.preferences)) p.needs ||= [];
        s.drafts ||= [];
        s.draftBallots ||= {};
        s.draftGeneration ??= 0;
        for (const p of s.proposals) p.estimate ||= { costPaise: null, travel: null };
        for (const stop of s.stops) {
            stop.costKnown ??= stop.cost > 0;
            stop.travelKnown ??= typeof stop.travel === "number" && Number.isFinite(stop.travel);
            stop.pinned ??= false;
        }
        return s;
    }
    function baseEstimate(s, stops = s.stops) {
        return {
            paise: stops.reduce((n, p) => n + (p.costKnown ? Math.round(p.cost * 100) : 0), 0),
            unknown: stops.filter((p) => !p.costKnown).length,
        };
    }
    function mustMatches(p, needle) {
        return (
            !needle ||
            `${p.place.name} ${p.place.category} ${p.note || ""}`
                .toLowerCase()
                .includes(needle.toLowerCase())
        );
    }
    function needsMatches(p, pref) {
        return Boolean(
            pref &&
                ((pref.mustHave && mustMatches(p, pref.mustHave)) ||
                    pref.needs?.includes(p.place.category)),
        );
    }
    function availableWindows(s, memberId) {
        const selected = s.availability.responses[memberId] || [],
            ranges = s.availability.options
                .filter((o) => selected.includes(o.id))
                .map((o) => Time.interval(o));
        return Time.merge(ranges);
    }
    function availabilityIssues(s, stops) {
        const hard = [],
            missing = [];
        const polled = Time.merge(s.availability.options.map((o) => Time.interval(o)));
        for (const m of members(s)) {
            const response = s.availability.responses[m.id];
            if (!response) {
                missing.push(`${m.name}: availability unanswered`);
                continue;
            }
            for (const stop of stops) {
                const required = Time.interval(stop, stop.travel),
                    windows = availableWindows(s, m.id);
                if (!Time.covers(polled, required))
                    missing.push(
                        `${m.name}: no polled availability for all of ${Time.label(stop)} and its travel buffer`,
                    );
                if (Time.intersect(polled, [required]).some((r) => !Time.covers(windows, r)))
                    hard.push(`${m.name}: ${stop.place.name} is outside their available windows`);
            }
        }
        return { hard: [...new Set(hard)], missing: [...new Set(missing)] };
    }
    function assess(s, stops) {
        const estimate = baseEstimate(s, stops),
            hard = [],
            missing = [],
            unmet = [];
        for (const m of members(s)) {
            const p = s.preferences[m.id];
            if (!p) {
                missing.push(`${m.name}: trip preferences missing`);
                continue;
            }
            if (p.budgetPaise === null) missing.push(`${m.name}: budget limit missing`);
            else if (estimate.paise > p.budgetPaise)
                hard.push(
                    `${m.name}: known estimated cost exceeds their budget by ₹${((estimate.paise - p.budgetPaise) / 100).toFixed(2)}`,
                );
            for (const need of p.needs || []) {
                if (stops.some((x) => x.place.category === need)) continue;
                if (stops.some((x) => !x.place.category))
                    missing.push(
                        `${m.name}: required ${need} activity cannot be checked — category missing`,
                    );
                else hard.push(`${m.name}: required ${need} activity is not included`);
            }
            if (p.mustHave) {
                if (stops.some((x) => mustMatches(x, p.mustHave)))
                    missing.push(
                        `${m.name}: must-have “${p.mustHave}” matches text only; suitability still needs their review`,
                    );
                else if (stops.some((x) => x.place.provider === "google" && !x.place.label))
                    missing.push(
                        `${m.name}: must-have “${p.mustHave}” cannot be fully checked — saved place labels missing`,
                    );
                else hard.push(`${m.name}: literal must-have “${p.mustHave}” is not included`);
            }
            if (p.interests.length && !stops.some((x) => p.interests.includes(x.place.category)))
                unmet.push(`${m.name}: interests not represented`);
            if (
                p.pace === "relaxed" &&
                Object.values(
                    stops.reduce((o, x) => ((o[x.date] = (o[x.date] || 0) + 1), o), {}),
                ).some((n) => n > 2)
            )
                unmet.push(`${m.name}: prefers a slower pace`);
        }
        if (estimate.unknown)
            missing.push(
                `${estimate.unknown} activity cost estimate(s) missing — affordability unverified`,
            );
        if (stops.some((x) => !x.travelKnown))
            missing.push(
                "Some travel buffers are unspecified; zero in a draft reserves no travel time",
            );
        if (stops.length)
            missing.push(
                "Opening hours, admission and ticket availability must be checked with venues",
            );
        const availability = availabilityIssues(s, stops);
        return {
            estimate,
            hard: [...new Set([...hard, ...availability.hard])],
            missing: [...new Set([...missing, ...availability.missing])],
            unmet,
        };
    }
    function rank(s, extra = []) {
        const pool = new Map(s.proposals.map((p) => [p.place.id, p]));
        for (const place of extra)
            if (!pool.has(place.id))
                pool.set(place.id, {
                    id: place.id,
                    place,
                    responses: {},
                    estimate: { costPaise: null, travel: null },
                });
        const base = baseEstimate(s),
            active = members(s);
        return [...pool.values()]
            .filter((p) => p.place.city.toLowerCase() === s.trip.city.toLowerCase())
            .map((p) => {
                const matches = active.filter((m) =>
                    s.preferences[m.id]?.interests.includes(p.place.category),
                );
                const wants = active.filter((m) => needsMatches(p, s.preferences[m.id]));
                const existing = s.stops.filter((x) => x.proposalId === p.id),
                    ownKnown = existing
                        .filter((x) => x.costKnown)
                        .reduce((n, x) => n + Math.round(x.cost * 100), 0);
                const cost =
                        knownCost(p) ??
                        (existing.length && existing.every((x) => x.costKnown) ? ownKnown : null),
                    exceeds = active.filter(
                        (m) =>
                            s.preferences[m.id]?.budgetPaise != null &&
                            cost != null &&
                            base.paise - ownKnown + cost > s.preferences[m.id].budgetPaise,
                    );
                const missing = [],
                    reasons = [],
                    unmet = [];
                let score = matches.length * 4 + wants.length * 8;
                const interested = active.filter((m) => p.responses?.[m.id] === "interested"),
                    maybe = active.filter((m) => p.responses?.[m.id] === "maybe"),
                    pass = active.filter((m) => p.responses?.[m.id] === "pass");
                score +=
                    interested.length * 3 + maybe.length - pass.length * 2 - exceeds.length * 20;
                if (matches.length)
                    reasons.push(
                        `Matches ${matches.length} member(s)' interests: ${matches.map((m) => m.name).join(", ")}`,
                    );
                if (wants.length)
                    reasons.push(
                        `Matches a requested category or literal label for ${wants.map((m) => m.name).join(", ")}`,
                    );
                reasons.push(
                    `${interested.length} Interested · ${maybe.length} Maybe · ${pass.length} Pass`,
                );
                if (exceeds.length)
                    unmet.push(
                        `Exceeds ${exceeds.length} member(s)' budget with the current plan: ${exceeds.map((m) => m.name).join(", ")}`,
                    );
                if (pass.length)
                    unmet.push(`Not interested: ${pass.map((m) => m.name).join(", ")}`);
                const day = p.preferredDate || p.place.eventDate || s.trip.start;
                const polled = Time.merge(s.availability.options.map((o) => Time.interval(o))),
                    dayRange = [Time.day(day), Time.day(day) + 1440],
                    hasPoll = Time.intersect(polled, [dayRange]).length > 0;
                for (const m of active) {
                    const response = s.availability.responses[m.id];
                    if (!response) missing.push(`${m.name}: availability unanswered`);
                    else if (!hasPoll) missing.push(`${m.name}: no polled availability for ${day}`);
                    if (s.preferences[m.id] && s.preferences[m.id].budgetPaise === null)
                        missing.push(`${m.name}: budget limit missing`);
                    if (
                        response &&
                        hasPoll &&
                        !Time.intersect(availableWindows(s, m.id), [dayRange]).length
                    ) {
                        unmet.push(`${m.name}: unavailable on suggested day ${day}`);
                        score -= 20;
                    }
                }
                if (p.place.eventTime && day === p.place.eventDate) {
                    const start = Time.day(day) + Time.minute(p.place.eventTime),
                        timing = Time.windowValue([start, start + p.place.duration]),
                        issues = availabilityIssues(s, [
                            { ...timing, place: p.place, travel: p.estimate?.travel ?? 0 },
                        ]);
                    unmet.push(...issues.hard);
                    missing.push(...issues.missing);
                    score -= issues.hard.length * 20;
                }
                for (const m of wants) {
                    const pref = s.preferences[m.id];
                    if (pref.mustHave && mustMatches(p, pref.mustHave))
                        missing.push(
                            `${m.name}: literal must-have match does not verify dietary suitability, accessibility or opening hours`,
                        );
                }
                if (cost === null) missing.push("Cost estimate unknown — affordability unverified");
                if (p.estimate?.travel == null && !existing.some((x) => x.travelKnown))
                    missing.push("Travel estimate missing");
                if (base.unknown) missing.push("Current itinerary has missing cost estimates");
                const incomplete = active.filter((m) => !s.preferences[m.id]);
                if (incomplete.length)
                    missing.push(
                        `Preferences missing: ${incomplete.map((m) => m.name).join(", ")}`,
                    );
                missing.push("Opening hours / tickets unverified");
                if (
                    active.some((m) => s.preferences[m.id]?.pace === "relaxed") &&
                    p.place.duration <= 120
                ) {
                    score += 1;
                    reasons.push("Shorter planning duration suits a relaxed pace");
                }
                return {
                    proposal: p,
                    score,
                    reasons,
                    unmet: [...new Set(unmet)],
                    missing: [...new Set(missing)],
                    costPaise: cost,
                };
            })
            .sort(
                (a, b) =>
                    b.score - a.score || a.proposal.place.id.localeCompare(b.proposal.place.id),
            );
    }
    function generate(s, extra, C) {
        const ranked = rank(s, extra),
            fixed = s.stops.filter((p) => p.pinned || p.place.eventTime),
            days = C.dates(s.trip.start, s.trip.end),
            generation = s.draftGeneration + 1,
            polled = Time.merge(s.availability.options.map((o) => Time.interval(o)));
        const drafts = [
            ["relaxed", "Relaxed", 2, 45],
            ["activities", "More activities", 4, 15],
            ["cost", "Lower estimated cost", 2, 30],
        ].map(([kind, name, limit, gap]) => {
            const stops = copy(fixed);
            let choices = [...ranked];
            if (kind === "cost")
                choices.sort(
                    (a, b) =>
                        (a.costPaise === null) - (b.costPaise === null) ||
                        (a.costPaise ?? Infinity) - (b.costPaise ?? Infinity) ||
                        b.score - a.score,
                );
            // Supplied category needs and literal requests get first consideration.
            choices.sort(
                (a, b) =>
                    Number(members(s).some((m) => needsMatches(b.proposal, s.preferences[m.id]))) -
                    Number(members(s).some((m) => needsMatches(a.proposal, s.preferences[m.id]))),
            );
            const wanted = choices.filter(
                (r) => !stops.some((x) => x.place.id === r.proposal.place.id),
            );
            for (const r of wanted) {
                const p = r.proposal,
                    preferred = p.preferredDate || "";
                let placed = false;
                for (const day of days) {
                    if (preferred && day !== preferred) continue;
                    if (
                        p.place.eventDate &&
                        (day < p.place.eventDate || day > p.place.eventEndDate)
                    )
                        continue;
                    const existing = stops.filter((x) => x.date === day);
                    if (existing.length >= limit) continue;
                    const previous = s.stops.find((x) => x.proposalId === p.id);
                    const travelEstimate =
                        p.estimate?.travel ?? (previous?.travelKnown ? previous.travel : null);
                    const travel = travelEstimate ?? 0,
                        duration = p.place.duration;
                    const base = Time.day(day),
                        chosen = polled.filter(([start, end]) => start < base + 1440 && end > base);
                    const fixedStart =
                        p.place.eventTime && day === p.place.eventDate
                            ? base + C.minutes(p.place.eventTime)
                            : null;
                    const bounds = chosen.length
                        ? chosen
                        : [
                              [
                                  base + (fixedStart === null ? 540 : 0),
                                  base + (fixedStart === null ? 1260 : 2880),
                              ],
                          ];
                    // Include raw poll starts: an intersection can begin inside a merged window.
                    const boundaries = s.availability.options.map((o) => Time.interval(o)[0]);
                    const starts =
                        fixedStart !== null
                            ? [fixedStart]
                            : [
                                  ...new Set([
                                      ...bounds.map(([start]) => Math.max(base, start) + travel),
                                      ...boundaries.map((start) => start + travel),
                                      ...stops.map((x) => Time.interval(x)[1] + gap + travel),
                                  ]),
                              ].sort((a, b) => a - b);
                    for (const start of starts) {
                        if (
                            start < base ||
                            start >= base + 1440 ||
                            !Time.covers(bounds, [start - travel, start + duration])
                        )
                            continue;
                        const cost = r.costPaise,
                            candidate = {
                                id: `d${generation}-${kind}-${stops.length}`,
                                place: copy(p.place),
                                proposalId: s.proposals.find((x) => x.id === p.id)?.id || "",
                                by: s.organizerId,
                                date: day,
                                start: Time.clock(start),
                                end: Time.clock(start + duration),
                                endNextDay: start + duration >= base + 1440,
                                travel,
                                travelKnown: travelEstimate !== null,
                                cost: (cost ?? 0) / 100,
                                costKnown: cost !== null,
                                note: "Draft timing; verify venues and manual travel estimates.",
                                pinned: false,
                            };
                        try {
                            C.slot({ ...s, stops }, candidate);
                            const check = assess(s, [...stops, candidate]);
                            if (
                                check.hard.some(
                                    (x) =>
                                        x.includes("exceeds their budget") ||
                                        x.includes("outside their available"),
                                )
                            )
                                continue;
                            stops.push(candidate);
                            placed = true;
                            break;
                        } catch {
                            /* A later slot may fit. */
                        }
                    }
                    if (placed) break;
                }
            }
            const assessment = assess(s, stops);
            return {
                id: `draft-${generation}-${kind}`,
                kind,
                name,
                sourceMaterialVersion: s.materialVersion,
                sourceInputs: inputs(s),
                sourceRevision: s.revision + 1,
                stops,
                assessment,
                searchNote: stops.length
                    ? "Uses a bounded greedy search of supplied places and candidate timings; other workable plans may exist."
                    : "This bounded search produced no scheduled activities. Review windows, fixed stops, estimates or candidates; this does not prove that no feasible plan exists.",
                travelMinutes: stops.reduce((n, p) => n + p.travel, 0),
                gapMinutes: gap,
                strategyNote:
                    kind === "cost"
                        ? "Prioritises lower supplied estimates; unknown costs prevent a reliable cost comparison."
                        : kind === "relaxed"
                          ? "Fewer daily stops and larger free gaps where constraints permit."
                          : "More daily stops and shorter free gaps where constraints permit.",
                createdAt: new Date().toISOString(),
            };
        });
        const seen = new Set();
        return drafts.filter((d) => {
            const signature = JSON.stringify(
                d.stops.map((p) => [
                    p.place.id,
                    p.date,
                    p.start,
                    p.end,
                    p.endNextDay,
                    p.cost,
                    p.costKnown,
                    p.travel,
                ]),
            );
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
        });
    }
    function execute(s, cmd, id, C) {
        const v = cmd.payload || {};
        switch (cmd.type) {
            case "savePreferences": {
                C.check(
                    Array.isArray(v.interests) &&
                        v.interests.length <= 6 &&
                        v.interests.every((x) => C.categories.includes(x)),
                    "Choose valid trip interests.",
                );
                C.check(
                    ["relaxed", "balanced", "packed"].includes(v.pace),
                    "Choose a travel pace.",
                );
                const budget =
                    v.budgetPaise === null
                        ? null
                        : C.number(v.budgetPaise, "Budget in paise", 0, 100000000);
                C.check(
                    budget === null || Number.isSafeInteger(budget),
                    "Budget must use integer paise.",
                );
                const needs = v.needs ?? [];
                C.check(
                    Array.isArray(needs) &&
                        needs.length <= 6 &&
                        needs.every((x) => C.categories.includes(x)),
                    "Choose required activity categories from the supplied list.",
                );
                s.preferences[id] = {
                    interests: [...new Set(v.interests)],
                    pace: v.pace,
                    budgetPaise: budget,
                    mustHave: C.text(v.mustHave || "", "Must-have", 120, false),
                    needs: [...new Set(needs)],
                };
                return true;
            }
            case "estimateSuggestion": {
                const p = s.proposals.find((x) => x.id === v.id);
                C.check(p, "Suggestion no longer exists.");
                const cost =
                    v.costPaise === null
                        ? null
                        : C.number(v.costPaise, "Estimated cost in paise", 0, 100000000);
                C.check(cost === null || Number.isSafeInteger(cost), "Use integer paise.");
                p.estimate = {
                    costPaise: cost,
                    travel:
                        v.travel === null
                            ? null
                            : C.number(v.travel, "Manual travel estimate", 0, 240),
                };
                return true;
            }
            case "pinStop":
                C.check(typeof v.pinned === "boolean", "Choose pinned or unpinned.");
                C.agreement.organizer(s, id, C);
                {
                    const p = s.stops.find((x) => x.id === v.id);
                    C.check(p, "Stop no longer exists.");
                    p.pinned = Boolean(v.pinned);
                }
                return true;
            case "generateDrafts":
                C.agreement.organizer(s, id, C);
                C.check(
                    Array.isArray(v.places) && v.places.length <= 80,
                    "Use up to 80 discovered candidates.",
                );
                s.drafts = generate(s, v.places.map(C.place), C);
                s.draftGeneration += 1;
                s.draftBallots = {};
                return true;
            case "voteDraft":
                C.check(
                    s.drafts.some((x) => x.id === v.id),
                    "Choose a current draft.",
                );
                s.draftBallots[id] = v.id;
                return true;
            case "applyDraft": {
                C.agreement.organizer(s, id, C);
                const d = s.drafts.find((x) => x.id === v.id);
                C.check(d, "Draft no longer exists.");
                C.check(
                    d.stops.length,
                    "This draft has no activities. Review the bounded search and regenerate before applying.",
                );
                C.check(
                    d.sourceRevision === s.drafts[0]?.sourceRevision &&
                        d.sourceMaterialVersion === s.materialVersion,
                    "The itinerary changed. Generate new drafts before applying.",
                );
                C.check(
                    d.sourceInputs === inputs(s),
                    "Group preferences, responses or pinned stops changed. Regenerate drafts before applying.",
                );
                const assessment = assess(s, d.stops);
                C.check(
                    !assessment.hard.length,
                    `This draft has unresolved constraints: ${assessment.hard.join("; ")}`,
                );
                C.check(
                    v.acknowledge === true,
                    "Acknowledge missing estimates and venue checks before applying.",
                );
                for (const fixed of s.stops.filter((p) => p.pinned || p.place.eventTime))
                    C.check(
                        d.stops.some((p) => JSON.stringify(p) === JSON.stringify(fixed)),
                        "Pinned and fixed-time stops must remain unchanged.",
                    );
                const stops = copy(d.stops);
                C.check(
                    s.stops
                        .filter(
                            (p) => s.visits[p.id] || s.scrapbook?.some((x) => x.stopId === p.id),
                        )
                        .every((p) => stops.some((x) => x.id === p.id)),
                    "A draft cannot remove visited stops or scrapbook memories. Pin those stops and regenerate.",
                );
                for (const p of s.proposals) p.status = "pending";
                for (const stop of stops) {
                    if (!stop.proposalId) {
                        const pid = `${d.id}-${stop.id}`;
                        s.proposals.push({
                            id: pid,
                            place: copy(stop.place),
                            by: id,
                            note: "From a discovered-place draft",
                            preferredDate: stop.date,
                            votes: [],
                            responses: {},
                            estimate: {
                                costPaise: stop.costKnown ? Math.round(stop.cost * 100) : null,
                                travel: stop.travelKnown ? stop.travel : null,
                            },
                            status: "pending",
                            createdAt: new Date().toISOString(),
                        });
                        stop.proposalId = pid;
                    }
                    const p = s.proposals.find((p) => p.id === stop.proposalId);
                    if (p) p.status = "scheduled";
                    C.slot({ ...s, stops: stops.filter((x) => x.id !== stop.id) }, stop, stop.id);
                }
                C.check(
                    s.proposals.length <= 500,
                    "Too many suggestions. Remove unused ideas first.",
                );
                s.stops = stops;
                s.lastAppliedDraft = {
                    id: d.id,
                    name: d.name,
                    by: id,
                    at: new Date().toISOString(),
                };
                return true;
            }
            default:
                return false;
        }
    }
    return { migrate, baseEstimate, rank, assess, generate, execute, mustMatches };
});
