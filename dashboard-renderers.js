/* Itinerary, ideas and preview rendering; mutations remain in the dashboard adapter. */
(function () {
    "use strict";
    function init(a) {
        const {
            $,
            C,
            esc,
            icon,
            categoryIcon,
            memberName,
            fmtDate,
            fmtTime,
            money,
            mapsUrl,
            displayPlace,
            displayStops,
            isPreview,
            empty,
        } = a;
        function renderIdeas({ state, memberId }) {
            const ideas = state.proposals
                .map((p) => ({ ...p, place: displayPlace(p.place) }))
                .sort(
                    (a, b) =>
                        (a.status === "scheduled") - (b.status === "scheduled") ||
                        b.votes.length - a.votes.length,
                );
            $("workspace").innerHTML =
                `<div class="section-heading"><div><h2>A few good ideas</h2><p>Everyone gets a say. Add the ones you agree on to the plan.</p></div><button class="button secondary small" data-action="custom">${icon("plus")}New idea</button></div>${ideas.length ? ideas.map((p) => `<article class="idea-card" data-proposal-id="${esc(p.id)}"><div class="idea-top"><span class="idea-category">${icon(categoryIcon[p.place.category])}</span><div class="idea-info"><h3>${esc(p.place.name)}</h3><small>${esc(p.place.city)} · Proposed by ${esc(memberName(p.by))}${p.preferredDate ? ` · ${fmtDate(p.preferredDate)}` : ""}</small></div>${p.status === "scheduled" ? '<span class="status-tag">In itinerary</span>' : p.by === memberId ? `<button class="icon-button" data-action="remove-idea" data-id="${esc(p.id)}" aria-label="Remove your idea for ${esc(p.place.name)}">${icon("close")}</button>` : ""}</div>${p.note ? `<p class="idea-note">“${esc(p.note)}”</p>` : ""}<div class="idea-actions">${p.status === "pending" ? `<button class="vote-button ${p.votes.includes(memberId) ? "voted" : ""}" data-action="vote" data-id="${esc(p.id)}" aria-pressed="${p.votes.includes(memberId)}">${icon("heart")}${p.votes.length} ${p.votes.length === 1 ? "vote" : "votes"} · ${p.votes.includes(memberId) ? "You’re in" : "I’m in"}</button><button class="button primary small" data-action="schedule" data-id="${esc(p.id)}">${icon("plus")}Add to itinerary</button>` : `<span class="idea-voters">${p.votes.length} currently interested</span><button class="text-button" data-view="itinerary">See in itinerary ${icon("arrow")}</button>`}</div><p class="idea-voters">${p.votes.length ? p.votes.map((id) => esc(memberName(id))).join(", ") : "No Interested responses yet"}</p></article>`).join("") : empty("The best trips start with ‘what if?’", "Explore places or add an event. Your friends can respond before you choose a time.", '<button class="button primary" data-view="discover">Discover places</button>')}`;
        }
        function renderItinerary({ state, memberId, exportBusy }) {
            const stops = displayStops();
            $("workspace").innerHTML =
                `<div class="section-heading"><div><h2>Make room for the good stuff</h2><p>Your shared itinerary · Times use ${esc(state.trip.timezone)}.</p></div><button class="button secondary small" data-action="export" ${exportBusy ? 'disabled aria-busy="true"' : ""}>${icon("download")}${exportBusy ? "Making PDF…" : "Export PDF"}</button></div>${C.dates(
                    state.trip.start,
                    state.trip.end,
                )
                    .map((day, i) => {
                        const dayStops = stops.filter((s) => s.date === day);
                        return `<div class="itinerary-day-heading"><strong>Day ${i + 1} <span>· ${fmtDate(day, { weekday: "short", day: "numeric", month: "short" })}</span></strong><span>${dayStops.length} stops</span></div>${dayStops.length ? dayStops.map((s) => `<article class="stop-card"><div class="stop-time">${fmtTime(s.start)}<small>to ${fmtTime(s.end)}${s.endNextDay ? " (+1 day)" : ""}</small></div><div class="stop-content"><h3>${esc(s.place.name)}</h3><p>${esc(s.place.area)}, ${esc(s.place.city)}</p>${s.note ? `<p>${esc(s.note)}</p>` : ""}<div class="stop-meta"><span>${s.travelKnown ? s.travel + " min manual travel buffer before" : "Travel time unknown"}</span><span>${s.costKnown ? money(s.cost) + " / person" : "Cost unknown"}</span><a href="${esc(mapsUrl(s.place))}" target="_blank" rel="noopener noreferrer">Find on map ↗</a></div></div><div class="stop-buttons"><button class="icon-button" ${s.pinned && state.organizerId !== memberId ? 'disabled title="Only the organizer can change a pinned stop"' : ""} data-action="edit-stop" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.place.name)}">${icon("edit")}</button><button class="icon-button" ${s.pinned && state.organizerId !== memberId ? 'disabled title="Only the organizer can remove a pinned stop"' : ""} data-action="remove-stop" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.place.name)} from itinerary">${icon("close")}</button></div></article>`).join("") : empty("A day full of possibilities", "Pick an idea from your group and give it a time.", '<button class="text-button" data-view="ideas">Choose from group ideas →</button>', true)}`;
                    })
                    .join("")}`;
        }
        function renderAside({ state, memberId, selectedDay }) {
            const days = C.dates(state.trip.start, state.trip.end);
            if (!days.includes(selectedDay)) selectedDay = days[0];
            const stops = displayStops().filter((s) => s.date === selectedDay),
                total = state.stops.reduce((sum, s) => sum + s.cost, 0),
                unknown = state.stops.some((s) => !s.costKnown),
                over = total > state.trip.budget;
            const ratio = state.trip.budget
                ? Math.min(100, (100 * total) / state.trip.budget)
                : total > 0
                  ? 100
                  : 0;
            $("itineraryAside").innerHTML =
                `<div class="aside-header"><h2>Our little itinerary</h2>${icon("route")}</div><p class="aside-subtitle">A little structure. A lot of good times.</p><div class="day-pills" aria-label="Preview a day">${days.map((d, i) => `<button class="day-pill ${d === selectedDay ? "active" : ""}" data-day="${d}" aria-pressed="${d === selectedDay}">Day ${i + 1} · ${fmtDate(d, { day: "numeric", month: "short" })}</button>`).join("")}</div>${stops.length ? `<div class="timeline">${stops.map((s) => `<div class="timeline-item"><span class="timeline-time">${fmtTime(s.start)} – ${fmtTime(s.end)}${s.endNextDay ? " (+1)" : ""}</span><p class="timeline-name">${esc(s.place.name)}</p><span class="timeline-caption">${esc(s.place.area)} · ${s.costKnown ? money(s.cost) + " / person" : "Cost unknown"}</span><br><button class="text-button" ${s.pinned && state.organizerId !== memberId ? 'disabled title="Only the organizer can change a pinned stop"' : ""} data-action="edit-stop" data-id="${esc(s.id)}">Adjust the plan ${icon("edit")}</button></div>`).join("")}</div>` : empty("Still a blank page", "Pick an idea and give it a time.", "", true)}<button class="add-stop" data-view="ideas">+ Add from group ideas</button><div class="budget-summary"><div class="budget-heading"><span>Known whole-trip estimate / person</span><strong>${money(total)}</strong></div><div class="budget-track ${over ? "over" : ""}" role="meter" aria-label="Estimated budget used" aria-valuemin="0" aria-valuemax="${Math.max(state.trip.budget, total, 1)}" aria-valuenow="${total}"><span style="width:${ratio}%"></span></div><div class="budget-foot"><span>${over ? `${money(total - state.trip.budget)} over budget` : `${money(state.trip.budget - total)} ${unknown ? "before unknown costs" : "left to plan"}`}</span><span>of ${money(state.trip.budget)}</span></div></div><div class="aside-note">Leave a little room for the unexpected. ✧<span>${isPreview() ? "Preview itinerary · Costs are illustrative estimates." : "Your times and costs · Check venue availability."}</span></div>`;
            return selectedDay;
        }

        return { renderIdeas, renderItinerary, renderAside };
    }
    window.PlanmateRenderers = { init };
})();
