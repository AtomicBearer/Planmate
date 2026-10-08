/* Shared planning controls use the dashboard's existing mutation and refresh path. */
(function () {
    "use strict";
    const C = window.PlannerCore,
        R = C.agreement,
        esc = window.PlanmateUtils.escapeHtml;
    const uid = window.PlanmateUtils.uniqueId;
    const { button, field, panel, notice } = window.PlanmateUI;
    const names = (members) => members.map((m) => esc(m.name)).join(", ") || "None";
    function init(a) {
        let saving = false;
        const state = () => a.state(),
            me = () => a.memberId();
        const host = () => state().organizerId === me();
        const Fit = R.fit;
        const outingUI = window.OutingUI.init(a, { button, field, panel, notice, run });
        const memoriesUI = window.MemoriesUI.init(a, { button, field, panel, notice, run });
        function prefForm() {
            const p = state().preferences[me()] || {
                interests: [],
                pace: "balanced",
                budgetPaise: null,
                mustHave: "",
                needs: [],
            };
            return `<form data-plan-form="preferences"><fieldset class="plan-choice"><legend>Interests for this trip</legend>${C.categories.map((c) => `<label><input name="interests" type="checkbox" value="${c}" ${p.interests.includes(c) ? "checked" : ""}>${c}</label>`).join("")}</fieldset>${field(
                "Preferred pace",
                `<select name="pace">${[
                    ["relaxed", "Slow & easy"],
                    ["balanced", "Balanced"],
                    ["packed", "Lots of activities"],
                ]
                    .map(
                        ([v, l]) =>
                            `<option value="${v}" ${v === p.pace ? "selected" : ""}>${l}</option>`,
                    )
                    .join("")}</select>`,
            )}${field("Whole-trip limit / person (₹, optional)", `<input name="budget" type="number" min="0" max="1000000" step="0.01" value="${p.budgetPaise === null ? "" : p.budgetPaise / 100}" placeholder="Unknown until supplied">`)}${field("Place or label must-have (optional)", `<input name="mustHave" maxlength="120" value="${esc(p.mustHave)}" placeholder="e.g. Artjuna (literal label)">`)}<fieldset class="plan-choice"><legend>Required activity types (optional)</legend>${C.categories.map((c) => `<label><input name="needs" type="checkbox" value="${c}" ${(p.needs || []).includes(c) ? "checked" : ""}>${c}</label>`).join("")}</fieldset>${notice("Budget limits and required categories constrain drafts using supplied estimates and categories. A typed must-have only matches names, categories or group notes; a text match cannot verify dietary suitability, accessibility or opening hours. Confirm these needs with the venue. Interests and pace are preferences. Saving shares these fields with this trip only.")}<div class="plan-row">${button("copy-profile", "Copy interests & pace from my profile")}<button type="submit" class="button primary small">Share my trip preferences</button></div><p data-copy-status class="plan-notice"></p></form>`;
        }
        function preferences() {
            const s = state();
            return panel(
                "A plan with room for everyone",
                prefForm() +
                    notice(
                        `Needs still missing: ${names(s.members.filter((m) => !m.removed).filter((m) => !s.preferences[m.id]))}`,
                    ) +
                    `<details><summary>Shared preferences</summary>${s.members
                        .map((m) => {
                            const p = s.preferences[m.id];
                            return notice(
                                `${m.name}: ${p ? `${p.interests.join(", ") || "No interests selected"} · ${p.pace} pace · ${p.budgetPaise === null ? "Budget unknown" : a.money(p.budgetPaise / 100) + " limit"}${p.mustHave ? " · Literal must-have: " + p.mustHave : ""}${p.needs?.length ? " · Required: " + p.needs.join(", ") : ""}` : "Hasn't shared preferences"}`,
                            );
                        })
                        .join("")}</details>`,
            );
        }
        function recommendations() {
            const s = state(),
                rows = Fit.rank(
                    s,
                    a.allPlaces().filter((p) => p.city.toLowerCase() === s.trip.city.toLowerCase()),
                ).slice(0, 12);
            const current = Fit.assess(s, s.stops);
            return panel(
                "What suits everyone?",
                "<details><summary>How these recommendations work</summary>" +
                    notice(
                        "Ranked by matching interests (+4 each), required category or literal label matches (+8 per member), Interested (+3), Maybe (+1), Pass (−2), and known budget/availability conflicts (−20). A small relaxed-pace bonus favours shorter activities. Members who can't attend are excluded from fit, but remain in the group.",
                    ) +
                    "</details>" +
                    notice(
                        "Costs and travel are the group's planning estimates. Missing data remains unknown; this ranking does not verify opening hours or ticket availability.",
                    ) +
                    `<h3>Whose needs are still unmet in our itinerary?</h3>${[...current.hard, ...current.unmet].length ? [...current.hard, ...current.unmet].map((x) => `<p class="constraint-warning">${esc(x)}</p>`).join("") : notice("No supplied constraint or preference is currently unmet. Missing information still needs review.")}<details><summary>Current plan information to check</summary>${current.missing.map(notice).join("")}</details>` +
                    (rows.length
                        ? rows
                              .map(
                                  (r) =>
                                      `<article class="fit-card"><div class="plan-row"><h3>${esc(a.displayPlace(r.proposal.place).name)}</h3><span class="status-tag">Fit score ${r.score}</span></div>${r.reasons.map(notice).join("")}${r.unmet.map((x) => `<p class="constraint-warning">${esc(x)}</p>`).join("")}<details><summary>Missing information</summary>${r.missing.map(notice).join("")}</details><div class="plan-row">${s.proposals.some((p) => p.id === r.proposal.id) ? button("estimate", "Set cost & travel estimates", r.proposal.id) : `<button class="button secondary small" data-action="propose" data-id="${esc(r.proposal.place.id)}">Propose to the group</button>`}</div></article>`,
                              )
                              .join("")
                        : notice("Discover or suggest places to compare their fit.")),
            );
        }
        function draftPanel() {
            const s = state();
            return panel(
                "Three ways to make a day",
                notice(
                    "These drafts preserve pinned stops and published fixed-time activities. New activity times, gaps and durations are planning choices; unknown travel reserves zero minutes and must be reviewed. Applying a draft replaces the current itinerary only after your explicit confirmation.",
                ) +
                    (host()
                        ? button(
                              "generate-drafts",
                              s.drafts.length ? "Regenerate drafts" : "Generate up to three drafts",
                          )
                        : notice("Ask the organizer to generate alternative drafts.")) +
                    (s.drafts.length
                        ? s.drafts
                              .map(
                                  (d) =>
                                      `<article class="fit-card"><h3>${esc(d.name)}</h3>${notice(d.strategyNote || "Review this draft with the group.")}${notice(d.searchNote || "This uses a bounded search; other workable plans may exist.")}${notice(`${d.stops.length} activities · ${a.money(d.assessment.estimate.paise / 100)} known estimate / person${d.assessment.estimate.unknown ? ` + ${d.assessment.estimate.unknown} unknown cost(s)` : ""} · ${d.travelMinutes} min manual travel buffers · ${d.gapMinutes} min free gaps`)}${d.stops.map((p) => notice(`${R.time.label(p)} · ${a.displayPlace(p.place).name}${p.pinned ? " · pinned" : ""}`)).join("")}${d.assessment.hard.map((x) => `<p class="constraint-warning">Hard constraint: ${esc(x)}</p>`).join("")}${d.assessment.unmet.map((x) => notice(`Unmet preference: ${x}`)).join("")}<details><summary>Information to check</summary>${d.assessment.missing.map(notice).join("")}</details>${notice(`Draft votes: ${names(s.members.filter((m) => !m.removed).filter((m) => s.draftBallots[m.id] === d.id))}`)}<div class="plan-row">${button("vote-draft", "I prefer this draft", d.id, `aria-pressed="${s.draftBallots[me()] === d.id}"`)}${host() ? button("apply-draft", "Review & apply explicitly", d.id, d.assessment.hard.length || !d.stops.length ? "disabled" : "") : ""}</div></article>`,
                              )
                              .join("")
                        : notice(
                              "No drafts yet. Share preferences and estimates, then generate drafts. No current stops are changed.",
                          )),
            );
        }
        function agreement() {
            const s = state(),
                p = R.progress(s),
                own = s.availability.responses[me()] || [],
                attendance = s.attendance[me()];
            const options = R.availabilitySummary(s);
            return (
                panel(
                    "When can we go?",
                    notice(
                        `Organizer: ${a.memberName(s.organizerId)} · ${s.trip.timezone}. Select every window that works. Saving none means none work; a missing response means unanswered.`,
                    ) +
                        (options.length
                            ? `<form data-plan-form="availability"><div class="poll-options">${options.map((o) => `<label class="poll-option"><input type="checkbox" name="options" value="${esc(o.id)}" ${own.includes(o.id) ? "checked" : ""}><span><strong>${esc(R.time.label(o))}</strong><small>${o.available.length}/${s.members.filter((m) => !m.removed).length} available${o.common ? " · Everyone can go" : ""}${s.availability.chosen?.id === o.id ? " · Final date chosen" : ""}</small><small>${names(o.available)}</small></span></label>`).join("")}</div><button class="button primary small" type="submit">Update my availability</button></form>`
                            : notice(
                                  "No dates proposed yet. The organizer can add windows below.",
                              )) +
                        notice(`Missing responses: ${names(p.missing)}`) +
                        notice(
                            `Common availability: ${
                                R.commonWindows(s).map(R.time.label).join(" · ") ||
                                (p.missing.length
                                    ? "Awaiting everyone's response"
                                    : "No common window yet")
                            }`,
                        ) +
                        (host()
                            ? `<form data-plan-form="add-date" class="plan-form-grid">${field("Date", `<input type="date" name="date" value="${s.trip.start}" required>`)}${field("From", '<input type="time" name="start" value="09:00" required>')}${field("Until", '<input type="time" name="end" value="21:00" required>')}<label class="plan-check"><input type="checkbox" name="endNextDay"> Ends next day <small>All clocks use the trip timezone.</small></label><button class="button secondary" type="submit">Add a date option</button></form>${options.map((o) => `<div class="plan-row"><span>${esc(R.time.label(o))}</span>${button("choose-date", "Choose final date", o.id)}${s.availability.chosen?.id !== o.id ? button("remove-date", "Remove", o.id) : ""}</div>`).join("")}`
                            : "") +
                        notice(
                            "The most popular window stays a proposal until the organizer chooses it. Adding an option asks everyone to review the poll again.",
                        ),
                ) +
                panel(
                    "Who is coming?",
                    `<div class="plan-row">${[
                        ["in", "I'm in"],
                        ["maybe", "Maybe"],
                        ["out", "Can't make it"],
                    ]
                        .map(([v, l]) =>
                            button(
                                "attendance",
                                l,
                                v,
                                `aria-pressed="${attendance?.response === v && attendance.version === s.materialVersion}"`,
                            ),
                        )
                        .join(
                            "",
                        )}</div>${notice(`Confirmed: ${names(p.inMembers)}`)}${notice(`Tentative: ${names(s.members.filter((m) => !m.removed).filter((m) => s.attendance[m.id]?.response === "maybe"))}`)}${notice(`Can't make it: ${names(s.members.filter((m) => !m.removed).filter((m) => s.attendance[m.id]?.response === "out"))}`)}${notice(`Unanswered: ${names(p.unanswered)}`)}${p.reconfirm.length ? notice(`Plan changed — please reconfirm: ${names(p.reconfirm)}`) : ""}`,
                ) +
                panel(
                    "What happens next?",
                    `<strong>${esc(p.stage)}</strong>${notice(p.next)}${s.confirmation ? notice(`Agreed version ${s.confirmation.revision}, recorded ${new Date(s.confirmation.at).toLocaleString("en-IN", { timeZone: s.trip.timezone })}${s.confirmation.needsReview ? " · Changed since confirmation" : ""}.`) : ""}${host() ? (s.availability.chosen && s.stops.length ? button("confirm", s.confirmation && !s.confirmation.needsReview ? "Record this version again" : "Confirm this plan explicitly") : notice("Choose a final date and schedule at least one activity before confirming.")) : notice("The organizer records the final plan. Anyone can still suggest later changes.")}`,
                )
            );
        }
        function responses(p) {
            const own = p.responses[me()];
            return `<div class="quick-responses">${[
                ["interested", "Interested"],
                ["maybe", "Maybe"],
                ["pass", "Pass"],
            ]
                .map(([v, l]) =>
                    button(
                        "response",
                        `${l} · ${Object.values(p.responses).filter((r) => r === v).length}`,
                        p.id,
                        `data-response="${v}" aria-pressed="${own === v}"`,
                    ),
                )
                .join("")}</div>${notice(
                `Unanswered: ${names(
                    state()
                        .members.filter((m) => !m.removed)
                        .filter((m) => !p.responses[m.id]),
                )}`,
            )}`;
        }
        function render(view) {
            const p = R.progress(state(), me());
            document.getElementById("planningProgress").innerHTML =
                `<div><span class="tiny-label">OUR NEXT STEP</span><strong>${esc(p.stage)}</strong><p>${esc(p.next)}</p></div><button class="button secondary small" data-view="${esc(p.nextView)}">${esc(p.nextLabel)} →</button>`;
            if (view === "group")
                document
                    .getElementById("workspace")
                    .insertAdjacentHTML("afterbegin", agreement() + membership());
            if (view === "fit")
                document.getElementById("workspace").innerHTML =
                    preferences() + recommendations() + draftPanel();
            if (view === "ideas")
                document.querySelectorAll(".idea-card").forEach((card, i) => {
                    const id = card.dataset.proposalId;
                    const p =
                        state().proposals.find((p) => p.id === id) ||
                        state().proposals.find(
                            (p) =>
                                a.displayPlace(p.place).name ===
                                card.querySelector("h3")?.textContent,
                        );
                    if (!p) return;
                    card.querySelector(".vote-button")?.remove();
                    card.insertAdjacentHTML("beforeend", responses(p));
                });
            if (view === "itinerary")
                document.querySelectorAll(".stop-card").forEach((card) => {
                    const id = card.querySelector('[data-action="edit-stop"]')?.dataset.id,
                        stop = state().stops.find((p) => p.id === id);
                    if (stop && host())
                        card.querySelector(".stop-content").insertAdjacentHTML(
                            "beforeend",
                            button("pin", stop.pinned ? "Unpin this stop" : "Pin this stop", id),
                        );
                });
            document
                .querySelectorAll('[data-form="schedule"], [data-form="edit-stop"]')
                .forEach(addEstimateCheckbox);
            outingUI.render(view);
            memoriesUI.render(view);
        }
        async function run(type, payload, message = "Saved for the group.") {
            if (saving) throw new Error("Wait for your current change to finish.");
            saving = true;
            document.getElementById("planningProgress").setAttribute("aria-busy", "true");
            try {
                await a.mutate(type, payload);
                a.toast(message);
            } finally {
                saving = false;
                document.getElementById("planningProgress").removeAttribute("aria-busy");
            }
        }
        function membership() {
            if (!a.groupCode()) return "";
            const members = state()
                .members.filter((m) => !m.removed)
                .filter((m) => !m.removed);
            return panel(
                "People & permissions",
                notice(
                    "Only the organizer can transfer their role or remove members. Leaving keeps historical suggestions, comments, photos and balances attributed to their original authors.",
                ) +
                    members
                        .map(
                            (m) =>
                                `<div class="plan-row"><strong>${esc(m.name)}${m.id === state().organizerId ? " · organizer" : ""}</strong>${host() && m.id !== me() ? button("transfer-organizer", "Make organizer", m.id) + button("remove-member", "Remove member", m.id) : ""}</div>`,
                        )
                        .join("") +
                    (host()
                        ? notice("Transfer the organizer role before leaving this trip.")
                        : button("leave-trip", "Leave this trip")) +
                    `<details><summary>Former members</summary>${
                        state()
                            .members.filter((m) => m.removed)
                            .map((m) => notice(m.name + " · historical records retained"))
                            .join("") || notice("No former members.")
                    }</details>`,
            );
        }
        function addEstimateCheckbox(form) {
            if (form.querySelector('[name="costKnown"]')) return;
            const p = state().stops.find((x) => x.id === form.dataset.id);
            form.querySelector('[name="cost"]')
                .closest(".form-row")
                .insertAdjacentHTML(
                    "afterend",
                    `<label class="checkbox-field"><input type="checkbox" name="costKnown" ${p?.costKnown ? "checked" : ""}>The cost is a supplied estimate (leave unchecked if unknown)</label>`,
                );
        }
        new MutationObserver(() =>
            document
                .querySelectorAll('[data-form="schedule"], [data-form="edit-stop"]')
                .forEach(addEstimateCheckbox),
        ).observe(document.getElementById("dialogContent"), { childList: true, subtree: true });
        document.addEventListener("click", async (event) => {
            const b = event.target.closest("[data-plan-action]");
            if (!b || b.disabled) return;
            const id = b.dataset.id;
            try {
                switch (b.dataset.planAction) {
                    case "transfer-organizer":
                    case "remove-member":
                    case "leave-trip": {
                        const action = b.dataset.planAction;
                        a.openDialog(
                            action === "transfer-organizer"
                                ? "Transfer organizer role"
                                : action === "remove-member"
                                  ? "Remove member"
                                  : "Leave this trip",
                            action === "transfer-organizer"
                                ? "This member will manage invitations, dates and confirmation."
                                : "Trip and media access will be revoked. Historical records and balances remain.",
                            `<form data-plan-form="membership" data-id="${esc(id)}" data-command="${action === "transfer-organizer" ? "transferOrganizer" : action === "remove-member" ? "removeMember" : "leaveTrip"}"><p>${esc(action === "leave-trip" ? a.memberName(me()) : a.memberName(id))}</p><div class="plan-error" role="alert"></div><button type="submit" class="button primary">${action === "transfer-organizer" ? "Transfer organizer role" : action === "remove-member" ? "Remove this member" : "Leave this trip"}</button></form>`,
                        );
                        break;
                    }
                    case "copy-profile": {
                        const p = window.PlanmateProfile.load(),
                            f = document.querySelector('[data-plan-form="preferences"]'),
                            map = {
                                beaches: "Beach",
                                food: "Food",
                                nightlife: "Nightlife",
                                heritage: "Sights",
                                nature: "Outdoors",
                                events: "Event",
                                adventure: "Outdoors",
                                markets: "Sights",
                            },
                            interests = p.placeTypes.map((x) => map[x]);
                        f.querySelectorAll('[name="interests"]').forEach(
                            (x) => (x.checked = interests.includes(x.value)),
                        );
                        f.elements.pace.value = p.pace;
                        f.querySelector("[data-copy-status]").textContent =
                            "Copied into this form with your consent. Review and press Share to save for this trip; your profile is unchanged. Budget style is not a numeric limit and was not copied.";
                        break;
                    }
                    case "estimate": {
                        const p = state().proposals.find((x) => x.id === id),
                            e = p.estimate;
                        a.openDialog(
                            "Planning estimates",
                            a.displayPlace(p.place).name,
                            `<form data-plan-form="estimate" data-id="${esc(id)}">${field("Estimated cost per person (₹)", `<input name="cost" type="number" step="0.01" min="0" max="1000000" value="${e.costPaise === null ? "" : e.costPaise / 100}" placeholder="Leave blank if unknown">`)}${field("Manual travel buffer before (minutes)", `<input name="travel" type="number" step="1" min="0" max="240" value="${e.travel ?? ""}" placeholder="Leave blank if unknown">`)}${notice("Only enter a planning estimate your group can explain. Zero is an explicit estimate, not missing data.")}<div class="plan-error" role="alert"></div><button type="submit" class="button primary">Save estimates</button></form>`,
                        );
                        break;
                    }
                    case "pin":
                        await run("pinStop", {
                            id,
                            pinned: !state().stops.find((p) => p.id === id).pinned,
                        });
                        break;
                    case "generate-drafts":
                        await run(
                            "generateDrafts",
                            {
                                places: a
                                    .allPlaces()
                                    .filter(
                                        (p) =>
                                            p.city.toLowerCase() ===
                                            state().trip.city.toLowerCase(),
                                    )
                                    .slice(0, 80),
                            },
                            "Drafts generated. Your current itinerary is unchanged.",
                        );
                        break;
                    case "vote-draft":
                        await run("voteDraft", { id });
                        break;
                    case "apply-draft": {
                        const d = state().drafts.find((x) => x.id === id);
                        a.openDialog(
                            "Apply this draft?",
                            "This explicitly replaces the itinerary with the draft. Pinned and fixed-time stops are retained.",
                            `<form data-plan-form="apply-draft" data-id="${esc(id)}"><h3>${esc(d.name)}</h3>${d.assessment.missing.map(notice).join("")}<label class="checkbox-field"><input name="acknowledge" type="checkbox" required>I have reviewed unknown costs, travel and venue details with the group.</label><div class="plan-error" role="alert"></div><button type="submit" class="button primary">Replace itinerary with this draft</button></form>`,
                        );
                        break;
                    }
                    case "attendance":
                        await run(
                            "respondAttendance",
                            { response: id },
                            "Your attendance response is saved.",
                        );
                        break;
                    case "response":
                        await run("respondSuggestion", {
                            id,
                            response:
                                state().proposals.find((p) => p.id === id)?.responses[me()] ===
                                b.dataset.response
                                    ? ""
                                    : b.dataset.response,
                        });
                        break;
                    case "remove-date":
                        await run("removeAvailability", { id });
                        break;
                    case "confirm": {
                        const summary = R.progress(state());
                        const assessment = Fit.assess(state(), state().stops);
                        a.openDialog(
                            "Record the agreed plan",
                            "This records this version. Later changes remain possible and require reconfirmation.",
                            `<form data-plan-form="confirm">${notice(`Attendance confirmed: ${names(summary.inMembers)}. Still unanswered: ${names(summary.unanswered)}.`)}${summary.reconfirm.length ? notice(`Needs reconfirmation: ${names(summary.reconfirm)}`) : ""}${assessment.hard.map((x) => `<p class="constraint-warning">${esc(x)}</p>`).join("")}${assessment.unmet.map(notice).join("")}<details><summary>Information still to check · ${assessment.missing.length}</summary>${assessment.missing.map(notice).join("")}</details><p>Review these needs with your friends. Recording a version does not resolve conflicts, confirm attendance for someone else, or book venues.</p><div class="plan-error" role="alert"></div><button type="submit" class="button primary">Confirm this version</button></form>`,
                        );
                        break;
                    }
                    case "choose-date": {
                        const s = state(),
                            o = s.availability.options.find((o) => o.id === id),
                            endingDay = R.time.dateAt(R.time.interval(o)[1]);
                        a.openDialog(
                            "Choose the final date",
                            "Activities keep their existing dates. Review any conflicts before saving.",
                            `<form data-plan-form="choose-date" data-id="${esc(id)}"><p>Available window ${esc(R.time.label(o))} · ${esc(s.trip.timezone)}</p>${field("Trip end date", `<input type="date" name="endDate" value="${endingDay <= s.trip.end ? s.trip.end : endingDay}" min="${endingDay}" required>`)}<p data-date-conflicts></p><div class="plan-error" role="alert"></div><button type="submit" class="button primary">Set final date</button></form>`,
                        );
                        updateDateConflicts();
                        break;
                    }
                }
            } catch (e) {
                a.toast(e.message);
            }
        });
        function updateDateConflicts() {
            const f = document.querySelector('[data-plan-form="choose-date"]');
            if (!f) return;
            const o = state().availability.options.find((o) => o.id === f.dataset.id);
            const issues = R.dateConflicts(state(), o.date, f.elements.endDate.value);
            f.querySelector("[data-date-conflicts]").textContent = issues.length
                ? `Can't change these dates yet: ${issues.join("; ")}. Move or remove those activities first.`
                : "No existing activities fall outside these dates.";
        }
        document.addEventListener("input", updateDateConflicts);
        document.addEventListener("submit", async (event) => {
            const f = event.target;
            if (!f.dataset.planForm) return;
            event.preventDefault();
            const d = Object.fromEntries(new FormData(f)),
                submit = f.querySelector('[type="submit"]');
            if (saving) return;
            submit.disabled = true;
            try {
                switch (f.dataset.planForm) {
                    case "membership":
                        await run(f.dataset.command, { memberId: f.dataset.id });
                        a.closeDialog();
                        if (f.dataset.command === "leaveTrip") location.href = "dashboard.html";
                        break;
                    case "preferences":
                        await run(
                            "savePreferences",
                            {
                                interests: new FormData(f).getAll("interests"),
                                pace: d.pace,
                                budgetPaise:
                                    d.budget === "" ? null : Math.round(Number(d.budget) * 100),
                                mustHave: d.mustHave,
                                needs: new FormData(f).getAll("needs"),
                            },
                            "Your trip preferences are shared. Your personal profile is unchanged.",
                        );
                        break;
                    case "estimate":
                        await run("estimateSuggestion", {
                            id: f.dataset.id,
                            costPaise: d.cost === "" ? null : Math.round(Number(d.cost) * 100),
                            travel: d.travel === "" ? null : Number(d.travel),
                        });
                        a.closeDialog();
                        break;
                    case "apply-draft":
                        await run(
                            "applyDraft",
                            { id: f.dataset.id, acknowledge: Boolean(d.acknowledge) },
                            "Draft applied. Review the itinerary with your group.",
                        );
                        a.closeDialog();
                        a.setView("itinerary");
                        break;
                    case "availability":
                        await run("respondAvailability", {
                            options: new FormData(f).getAll("options"),
                        });
                        break;
                    case "add-date":
                        await run("addAvailability", {
                            ...d,
                            endNextDay: Boolean(d.endNextDay),
                            id: uid(),
                        });
                        break;
                    case "choose-date":
                        await run(
                            "chooseAvailability",
                            { id: f.dataset.id, endDate: d.endDate },
                            "Final date chosen. Attendance may need reconfirmation.",
                        );
                        a.closeDialog();
                        break;
                    case "confirm":
                        await run("confirmPlan", {}, "This agreed version has been recorded.");
                        a.closeDialog();
                        break;
                }
                document.dispatchEvent(
                    new CustomEvent("planmate:form-saved", { detail: { form: f } }),
                );
            } catch (e) {
                const box = f.querySelector(".plan-error");
                if (box) box.textContent = e.message;
                else a.toast(e.message);
            } finally {
                submit.disabled = false;
            }
        });
        return { render, todayDay: outingUI.todayDay };
    }
    window.GroupPlanning = { init };
})();
