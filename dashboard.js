(() => {
    "use strict";
    const C = window.PlannerCore,
        catalogue = window.PlannerCatalogue;
    const navigation = new URLSearchParams(location.search);
    const incomingGroup = navigation.get("group");
    const requestedPlanCity = navigation.get("planCity");
    const views = window.PlanmateNavigation.views;
    const requestedView = Object.hasOwn(views, navigation.get("view"))
        ? navigation.get("view")
        : "discover";
    const requestedDay = navigation.get("day");
    const $ = (id) => document.getElementById(id);
    const { escapeHtml: esc, readJson: read, uniqueId: uid } = window.PlanmateUtils;
    const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
    const currencyFormatter = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
    const money = (value) => currencyFormatter.format(value);
    const categoryIcon = {
        Beach: "beach",
        Food: "food",
        Nightlife: "music",
        Sights: "sights",
        Outdoors: "leaf",
        Event: "calendar",
    };
    const categoryLabel = {
        All: "All places",
        Beach: "Beaches",
        Food: "Food & cafés",
        Nightlife: "Nightlife",
        Sights: "Sights",
        Outdoors: "Outdoors",
        Event: "Events",
    };
    const SPACE_KEY = "planmateSpacesV1",
        SESSION_KEY = "planmateSessionsV1",
        SAVED_KEY = "planmateSavedV1",
        SAVED_RECORDS_KEY = "planmateSavedRecordsV1";
    let storageOk = true;
    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            storageOk = false;
            toast("Browser storage is unavailable. Keep this tab open or start a shared plan.");
        }
    }
    const profile = read("PlanmateUser", null) || read("plansyncUser", null) || { name: "You" };
    let profileName = window.PlanmateProfile.load(
        typeof profile.name === "string" ? profile.name.slice(0, 60) : "You",
    ).name;
    let spaces = read(SPACE_KEY, {}),
        sessions = read(SESSION_KEY, {}),
        saved = read(SAVED_KEY, []);
    if (!spaces || typeof spaces !== "object" || Array.isArray(spaces)) spaces = {};
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) sessions = {};
    if (!Array.isArray(saved)) saved = [];
    const savedRecords = new Map();
    const storedRecords = read(SAVED_RECORDS_KEY, []);
    if (Array.isArray(storedRecords))
        for (const p of storedRecords) {
            try {
                const normalized = C.place(p);
                if (saved.includes(normalized.id)) savedRecords.set(normalized.id, normalized);
            } catch {
                /* Ignore damaged saved records. */
            }
        }
    let state,
        memberId,
        currentSpace,
        groupCode = "",
        groupToken = "",
        serverAvailable = false;
    let view = requestedView,
        city = "Goa",
        category = "All",
        search = "",
        visibleCount = 6,
        selectedDay,
        busy = false,
        exportBusy = false,
        openingShared = Boolean(incomingGroup),
        sharedOpenMessage =
            "Retrieving the current plan. Your group's dates, ideas and itinerary will appear here.",
        toastTimer;
    let liveConfig = {
        places: false,
        events: false,
        eventTypes: [
            "All",
            "Comedy",
            "Music",
            "Theatre",
            "Sports",
            "Festival",
            "Workshop",
            "Other",
        ],
    };
    const liveRecords = new Map();
    let liveContext = null,
        eventFrom = "",
        eventTo = "",
        eventType = "All",
        savedDetailsBusy = false;
    function liveKey() {
        return JSON.stringify([
            city,
            category,
            search.trim(),
            eventFrom || state.trip.start,
            eventTo || state.trip.end,
            eventType,
        ]);
    }
    function displayPlace(p) {
        const current = liveRecords.get(p.id);
        return current ? { ...current, ...(p.label ? { name: p.label, label: p.label } : {}) } : p;
    }
    function displayStops() {
        return C.orderedStops(state).map((s) => ({ ...s, place: displayPlace(s.place) }));
    }
    function placeVisual(p) {
        const url = p.photoUrl?.startsWith("/api/discovery/photo?")
            ? p.photoUrl
            : p.imageUrl?.startsWith("https://")
              ? p.imageUrl
              : "";
        return `${scene(p.category)}${url ? `<img class="venue-photo" src="${esc(url)}" alt="${esc(p.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="photo-placeholder">Category illustration</span>'}`;
    }
    function credits(p) {
        const authors = (p.photoAttributions || [])
            .map((a) =>
                a.url
                    ? `<a href="${esc(C.safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a>`
                    : esc(a.name),
            )
            .join(", ");
        const sources = (p.attributions || [])
            .map((a) =>
                a.url
                    ? `<a href="${esc(C.safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a>`
                    : esc(a.name),
            )
            .join(", ");
        return `<p class="photo-credit">${p.provider === "google" ? `<a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">Google Maps</a>${sources ? ` · ${sources}` : ""}` : esc(p.imageCredit || "")}${authors ? ` · Photo: ${authors}` : ""}${p.photoUrl && p.photoSource ? ` · <a href="${esc(p.photoSource)}" target="_blank" rel="noopener noreferrer">Source photo ↗</a>` : ""}</p>`;
    }
    function eventCaption(p) {
        return p.eventDate
            ? `${esc(p.eventType || "Event")} · ${fmtDate(p.eventDate)}${p.eventEndDate !== p.eventDate ? ` – ${fmtDate(p.eventEndDate)}` : ""}${p.eventTime ? ` · ${fmtTime(p.eventTime)} IST` : " · Time to be confirmed"}`
            : "";
    }
    function liveControls(isSaved) {
        if (isSaved)
            return `<div class="live-discovery"><p>Saved Google places keep their IDs. Refresh to see their current names and photos.</p><button class="button secondary" data-action="refresh-saved" ${savedDetailsBusy || !liveConfig.places ? "disabled" : ""}>${savedDetailsBusy ? "Refreshing…" : "Refresh saved place details"}</button></div>`;
        return `<div class="live-discovery">${category === "Event" ? `<div class="event-controls"><label>From<input id="eventFrom" type="date" value="${esc(eventFrom || state.trip.start)}"></label><label>Through<input id="eventTo" type="date" value="${esc(eventTo || state.trip.end)}"></label><label>Event type<select id="eventType">${liveConfig.eventTypes.map((t) => `<option ${t === eventType ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label></div>` : ""}<div class="live-actions"><button class="button secondary" data-action="live-search">${icon("search")}${category === "Event" ? "Find city events" : "Find more places"}</button><button class="button secondary" data-action="live-more" hidden>Load more results</button></div><p id="liveStatus" role="status" aria-live="polite"></p></div>`;
    }
    function updateLiveStatus() {
        const target = $("liveStatus");
        if (!target) return;
        const eventMode = category === "Event",
            enabled = eventMode ? liveConfig.events : liveConfig.places;
        const context = liveContext?.key === liveKey() ? liveContext : null;
        target.textContent =
            context?.message ||
            (enabled
                ? eventMode
                    ? "Search comedy, music, festivals and more for your chosen dates."
                    : "Browse beaches, cafés, food, nightlife, sights and outdoors. Keep loading to explore more of the city."
                : location.protocol === "file:" || !serverAvailable
                  ? "Open this dashboard through the planning server to use live discovery."
                  : eventMode
                    ? "Live events need a connected city events feed. You can still add an event from its ticket link."
                    : "Live places and venue photos are not connected yet. Starter picks are available below.");
        const start = document.querySelector('[data-action="live-search"]'),
            more = document.querySelector('[data-action="live-more"]');
        if (start) start.disabled = !enabled || city === "All" || Boolean(context?.pending);
        if (more) {
            more.hidden = !context || context.done || !context.started;
            more.disabled = Boolean(context?.pending);
        }
    }
    async function loadLive(more = false) {
        if (liveContext?.pending) return;
        const eventMode = category === "Event",
            key = liveKey();
        if (city === "All" || !(eventMode ? liveConfig.events : liveConfig.places)) return;
        if (!more || liveContext?.key !== key)
            liveContext = { key, cursor: "", page: 0, ids: new Set(), done: false, started: false };
        const context = liveContext;
        context.pending = true;
        context.message = eventMode
            ? "Finding city events…"
            : "Finding more places and venue photos…";
        updateLiveStatus();
        try {
            const params = new URLSearchParams({ city, q: search.trim() });
            if (eventMode) {
                params.set("from", eventFrom || state.trip.start);
                params.set("to", eventTo || state.trip.end);
                params.set("type", eventType);
                params.set("page", String(context.page));
            } else {
                params.set("category", category);
                if (context.cursor) params.set("cursor", context.cursor);
            }
            const result = await request(
                `/api/discovery/${eventMode ? "events" : "places"}?${params}`,
            );
            for (const p of result.places || result.events || []) {
                liveRecords.set(p.id, p);
                context.ids.add(p.id);
            }
            context.started = true;
            context.cursor = result.cursor || "";
            context.page = result.nextPage;
            context.done = eventMode ? result.nextPage === null : !context.cursor;
            context.message = `${context.ids.size} unique ${eventMode ? "events" : "live places"} found${context.done ? ". Search complete." : ". Load more to keep exploring."}${result.warnings?.length ? ` ${result.warnings.join(" ")}` : ""}${result.notice ? ` ${result.notice}` : ""}`;
            if (liveKey() === key && (view === "discover" || view === "saved")) {
                visibleCount = Math.max(visibleCount, 12);
                renderResults();
            }
        } catch (error) {
            context.message = error.message;
            if (error.status === 410) {
                context.started = false;
                context.done = true;
            }
        } finally {
            context.pending = false;
            updateLiveStatus();
        }
    }
    async function refreshSavedDetails() {
        if (savedDetailsBusy || !liveConfig.places) return;
        const references = new Map(
            allPlaces()
                .filter((p) => p.provider === "google")
                .map((p) => [p.id, p]),
        );
        for (const id of saved)
            if (id.startsWith("google-") && !references.has(id))
                references.set(id, { id, city: state.trip.city, category: "Sights" });
        const pending = [...references.values()]
            .filter(
                (p) =>
                    !liveRecords.has(p.id) ||
                    Date.now() - (liveRecords.get(p.id).fetchedAt || 0) >= 540000,
            )
            .slice(0, 10);
        if (!pending.length) return toast("Saved place details are up to date in this tab.");
        savedDetailsBusy = true;
        if (view === "saved") renderDiscover();
        let failures = 0;
        for (const p of pending) {
            try {
                const result = await request(
                    `/api/discovery/details?${new URLSearchParams({ id: p.id, city: p.city, category: p.category })}`,
                );
                if (result.place) liveRecords.set(p.id, result.place);
                else failures++;
            } catch {
                failures++;
            }
        }
        savedDetailsBusy = false;
        render();
        toast(
            failures
                ? "Some saved places couldn't be refreshed. Try again shortly."
                : "Refreshed saved places. Refresh again for the next batch if you have more than ten.",
        );
    }
    function localDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    function defaultTrip() {
        const start = new Date();
        start.setDate(start.getDate() + ((5 - start.getDay() + 7) % 7 || 7));
        const end = new Date(start);
        end.setDate(end.getDate() + 2);
        return {
            title: "Goa, here we come",
            city: "Goa",
            start: localDate(start),
            end: localDate(end),
            budget: 5000,
        };
    }
    function demo() {
        let s = C.createState(defaultTrip(), { id: "you", name: profileName });
        s.members.push(
            { id: "aarav", name: "Aarav" },
            { id: "riya", name: "Riya" },
            { id: "maya", name: "Maya" },
        );
        const baga = catalogue.places.find((p) => p.name === "Baga Beach"),
            fontainhas = catalogue.places.find((p) => p.name === "Fontainhas");
        for (const [p, id, start, end, cost, travel] of [
            [baga, "sample-beach", "09:00", "10:30", 0, 0],
            [fontainhas, "sample-walk", "12:00", "13:30", 150, 30],
        ]) {
            s = C.apply(
                s,
                {
                    type: "propose",
                    payload: { id, place: p, note: "A little exploring to start the day." },
                },
                "aarav",
            );
            s = C.apply(
                s,
                {
                    type: "schedule",
                    payload: {
                        id: `${id}-stop`,
                        proposalId: id,
                        date: s.trip.start,
                        start,
                        end,
                        cost,
                        travel,
                        note: "Preview stop — change the time and estimate to suit your group.",
                    },
                },
                "you",
            );
        }
        s = C.apply(
            s,
            {
                type: "propose",
                payload: {
                    id: "sample-cafe",
                    place: catalogue.places.find((p) => p.name === "Artjuna Café"),
                    note: "A slow lunch in Anjuna? We can decide the time together.",
                    preferredDate: s.trip.start,
                },
            },
            "riya",
        );
        s = C.apply(s, { type: "vote", payload: { id: "sample-cafe" } }, "maya");
        s = C.apply(
            s,
            {
                type: "propose",
                payload: {
                    id: "sample-club",
                    place: catalogue.places.find((p) => p.name === "Club Tito’s"),
                    note: "Keeping one evening free for a night out. Let’s check the programme first.",
                    preferredDate: s.trip.start,
                },
            },
            "maya",
        );
        return { state: s, memberId: "you", preview: true };
    }
    function validStored(entry) {
        try {
            C.validateTrip(entry.state.trip);
            return (
                entry.state.version === 1 &&
                Array.isArray(entry.state.proposals) &&
                Array.isArray(entry.state.stops) &&
                entry.state.members.some((m) => m.id === entry.memberId)
            );
        } catch {
            return false;
        }
    }
    if (!validStored(spaces.preview)) {
        spaces.preview = demo();
        write(SPACE_KEY, spaces);
    }
    const previewUser = spaces.preview.state.members.find((m) => m.id === "you");
    if (profileName !== "You" && previewUser && previewUser.name !== profileName) {
        previewUser.name = profileName;
        spaces.preview.memberId = "you";
        write(SPACE_KEY, spaces);
    }
    function activateLocal(id, clearUrl = true) {
        if (!validStored(spaces[id])) return;
        currentSpace = id;
        state = C.clone(spaces[id].state);
        memberId = spaces[id].memberId;
        groupCode = "";
        groupToken = "";
        city = state.trip.city;
        selectedDay = C.dates(state.trip.start, state.trip.end).includes(requestedDay)
            ? requestedDay
            : state.trip.start;
        if (clearUrl) openingShared = false;
        write("planmateActiveSpaceV1", id);
        if (clearUrl && location.protocol !== "file:")
            history.replaceState({}, "", location.pathname);
    }
    activateLocal(
        validStored(spaces[navigation.get("space")])
            ? navigation.get("space")
            : validStored(spaces[read("planmateActiveSpaceV1", "preview")])
              ? read("planmateActiveSpaceV1", "preview")
              : "preview",
        false,
    );
    if (profileName !== "You" && read("planmateLastProfileV1", "") !== profileName) {
        const previousName = read("planmateLastProfileV1", "");
        for (const entry of Object.values(spaces)) {
            if (!validStored(entry)) continue;
            const ownId = entry.preview ? "you" : entry.memberId;
            const own = entry.state.members.find((m) => m.id === ownId);
            if (own && (own.name === previousName || ownId === "you")) own.name = profileName;
        }
        state = C.clone(spaces[currentSpace].state);
        write(SPACE_KEY, spaces);
        write("planmateLastProfileV1", profileName);
    }
    function isPreview() {
        return !groupCode && Boolean(spaces[currentSpace]?.preview);
    }
    function memberName(id) {
        return state.members.find((m) => m.id === id)?.name || "A friend";
    }
    function fmtDate(value, options = { day: "numeric", month: "short" }) {
        return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-IN", {
            ...options,
            timeZone: "UTC",
        });
    }
    function fmtTime(value) {
        const m = C.minutes(value);
        return `${m % 720 < 60 ? 12 : Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "am" : "pm"}`;
    }
    function avatar(member, i = 0) {
        return `<span class="avatar color-${i % 4}" title="${esc(member.name)}">${esc(member.name.trim().slice(0, 1).toUpperCase())}</span>`;
    }
    function toast(message) {
        clearTimeout(toastTimer);
        $("appToast").textContent = message;
        $("appToast").classList.add("show");
        toastTimer = setTimeout(() => $("appToast").classList.remove("show"), 5000);
    }
    function setStatus(message) {
        $("saveStatus").innerHTML = `<span></span>${esc(message)}`;
    }
    function allPlaces() {
        const map = new Map(catalogue.places.map((p) => [p.id, p]));
        for (const [id, p] of savedRecords) map.set(id, p);
        for (const p of state.proposals) map.set(p.place.id, p.place);
        for (const [id, p] of liveRecords) map.set(id, p);
        for (const id of saved)
            if (id.startsWith("google-") && !map.has(id))
                map.set(id, {
                    id,
                    provider: "google",
                    name: "Saved Google Maps place",
                    city: state.trip.city,
                    area: state.trip.city,
                    category: "Sights",
                    duration: 90,
                    description: "Refresh saved place details to see this place.",
                    source: `https://www.google.com/maps/search/?api=1&query=place&query_place_id=${encodeURIComponent(id.slice(7))}`,
                });
        return [...map.values()];
    }
    function findPlace(id) {
        return allPlaces().find((p) => p.id === id);
    }
    function mapsUrl(p) {
        return p.provider === "google"
            ? p.source
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name}, ${p.area}, ${p.city}, India`)}`;
    }
    const scene = window.PlanmateArtwork.scene;
    function empty(title, description, action = "", compact = false) {
        return `<div class="empty-state ${compact ? "compact" : ""}">${icon("compass")}<h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
    }
    function renderHeader() {
        const progress = C.agreement.progress(state, memberId);
        document.querySelector(".hero").classList.toggle("compact-trip", !isPreview());
        $("entryGuide").hidden = !isPreview();
        const organizer = state.organizerId === memberId;
        const account = window.PlanmateAccount.account(),
            accountConfig = window.PlanmateAccount.config();
        $("accountBanner").innerHTML = account
            ? `Signed in as ${esc(account.name)} · Private profile syncs across devices. <button class="text-button" data-account-action="signout">Sign out</button>${groupCode && !state.members.find((m) => m.id === memberId)?.accountId ? '<button class="text-button" data-action="claim-membership">Bind this legacy membership to my account</button>' : ""}`
            : `${accountConfig.configured ? "Local demo session" : "Verified sign-in is not configured · Local demo"} <a href="login.html?${esc(navigationContext())}">Open sign-in</a>`;
        $("tripTitle").innerHTML = `${esc(state.trip.title)}<span aria-hidden="true">✦</span>`;
        $("sidebarTitle").textContent = state.trip.title;
        $("tripDates").textContent =
            `${fmtDate(state.trip.start)} – ${fmtDate(state.trip.end)} ${state.trip.end.slice(0, 4)}`;
        $("tripDateLabel").textContent = state.availability.chosen
            ? "CHOSEN TRIP DATES"
            : "PROPOSED TRIP DATES";
        $("planningBadge").innerHTML = `<span></span>${esc(progress.stage)}`;
        $("editTripButton").hidden = !organizer;
        $("tripBudget").innerHTML = `${money(state.trip.budget)} <span>trip target</span>`;
        $("memberAvatars").innerHTML = state.members
            .filter((m) => !m.removed)
            .slice(0, 4)
            .map(avatar)
            .join("");
        $("memberSummary").textContent =
            `${state.members.filter((m) => !m.removed).length} ${state.members.filter((m) => !m.removed).length === 1 ? "planner" : "friends"}${isPreview() ? " · preview" : ""}`;
        const personal = window.PlanmateProfile.load(
            groupCode ? memberName(memberId) : profileName,
        );
        $("profileName").textContent = personal.name;
        for (const id of ["profileAvatar", "mobileProfileAvatar"]) {
            $(id).textContent = personal.name.slice(0, 1).toUpperCase();
            $(id).className = `avatar profile-colour-${personal.colour}`;
        }
        const context = navigationContext();
        for (const id of ["profileLink", "mobileProfileLink"])
            $(id).href = `profile.html?${context}`;
        $("planHomeLink").href = `dashboard.html?${context}`;
        document.querySelector(".logout").href = `login.html?${context}`;
        try {
            sessionStorage.setItem(
                "planmateProfileContext",
                JSON.stringify({
                    group: groupCode,
                    name: personal.name,
                    view,
                    day: selectedDay,
                    space: currentSpace,
                }),
            );
        } catch {
            /* Profile navigation also works without session storage. */
        }
        $("heroSubtitle").textContent =
            `A ${C.dates(state.trip.start, state.trip.end).length}-day escape to ${state.trip.city}. A plan everyone can be part of.`;
        const count = state.proposals.filter((p) => p.status === "pending").length;
        $("ideaCount").textContent = count;
        $("tabIdeaCount").textContent = count;
        window.PlanmateNavigation.render(view);
        $("catalogueNote").textContent =
            liveConfig.places || liveConfig.events
                ? "City discovery · Places, photos & events"
                : `${catalogue.cities.length} destinations · Starter catalogue · Add your own`;
    }
    function citiesOptions(value, all = false) {
        const cities = [
            ...new Set([...catalogue.cities, ...allPlaces().map((p) => p.city), state.trip.city]),
        ];
        return `${all ? '<option value="All">All cities</option>' : ""}${cities.map((c) => `<option value="${esc(c)}" ${c === value ? "selected" : ""}>${esc(c)}</option>`).join("")}`;
    }
    function renderDiscover() {
        const photos = window.PlanmateUtils.captureImages($("workspace"));
        const isSaved = view === "saved";
        $("workspace").innerHTML =
            `<div class="section-heading"><div><h2>${isSaved ? "Your little wishlist" : "Where shall we go?"}</h2><p>${isSaved ? "Places you’ve saved, ready when the group is." : "Find a place you love. Let the group take it from there."}</p></div><span class="hand-note">a good plan starts with an idea ↙</span></div>
            <div class="discover-tools"><label class="search-box">${icon("search")}<input id="placeSearch" type="search" value="${esc(search)}" placeholder="Search a place, area, or vibe…" aria-label="Search places"></label><label class="city-picker">${icon("pin")}<select id="browseCity" aria-label="Browse a city">${citiesOptions(city, isSaved)}</select></label></div>
            <div class="category-filters" aria-label="Place categories">${["All", ...C.categories].map((c) => `<button class="filter-chip ${c === category ? "active" : ""}" data-category="${c}" aria-pressed="${c === category}">${c !== "All" ? icon(categoryIcon[c]) : ""}${categoryLabel[c]}</button>`).join("")}</div>
            ${liveControls(isSaved)}
            <div id="placeResults"></div><div class="custom-callout"><div><strong>Got a spot in mind?</strong><p>Add any restaurant, club, hidden gem, or event.</p></div><button class="button secondary" data-action="custom">${icon("plus")}Add your own</button></div>`;
        renderResults(photos);
    }
    function renderResults(photos) {
        const context = liveContext?.key === liveKey() ? liveContext : null;
        const places = allPlaces().filter((p) => {
            if (
                (city !== "All" && p.city !== city) ||
                (category !== "All" && p.category !== category) ||
                (view === "saved" && !saved.includes(p.id))
            )
                return false;
            if (
                !`${p.name} ${p.area} ${p.city} ${p.category} ${p.eventType || ""}`
                    .toLowerCase()
                    .includes(search.toLowerCase()) &&
                !context?.ids.has(p.id)
            )
                return false;
            if (
                p.eventDate &&
                view !== "saved" &&
                (p.eventDate > (eventTo || state.trip.end) ||
                    p.eventEndDate < (eventFrom || state.trip.start) ||
                    (eventType !== "All" && p.eventType !== eventType))
            )
                return false;
            // Google IDs deduplicate provider results; matching names also hide
            // the same starter landmark after its live counterpart is loaded.
            if (
                view !== "saved" &&
                p.provider !== "google" &&
                p.category !== "Event" &&
                [...liveRecords.values()].some(
                    (l) =>
                        l.provider === "google" &&
                        l.city === p.city &&
                        l.name
                            .normalize("NFKD")
                            .replace(/[^\p{L}\p{N}]/gu, "")
                            .toLowerCase() ===
                            p.name
                                .normalize("NFKD")
                                .replace(/[^\p{L}\p{N}]/gu, "")
                                .toLowerCase(),
                )
            )
                return false;
            return true;
        });
        if (context?.started)
            places.sort((a, b) => Number(context.ids.has(b.id)) - Number(context.ids.has(a.id)));
        const line = `<div class="results-line"><span>${places.length} ${places.length === 1 ? "option" : "options"}${city !== "All" ? ` in ${esc(city)}` : ""}</span><span>Venue photos where supplied · Starter illustrations</span></div>`;
        const cards = places
            .slice(0, visibleCount)
            .map((p) => {
                const proposal = state.proposals.find(
                    (idea) => idea.place.id === p.id && idea.status === "pending",
                );
                const bookmarked = saved.includes(p.id);
                return `<article class="place-card"><div class="place-visual">${placeVisual(p)}<span class="place-category">${categoryLabel[p.category]}</span><button class="save-place ${bookmarked ? "saved" : ""}" data-action="save-place" data-id="${esc(p.id)}" aria-label="${bookmarked ? "Unsave" : "Save"} ${esc(p.name)}" aria-pressed="${bookmarked}">${icon("heart")}</button></div><div class="place-body"><button class="place-title" data-action="details" data-id="${esc(p.id)}">${esc(p.name)}</button><p class="place-location">${icon("pin")}${esc(p.area)}, ${esc(p.city)}</p>${p.eventDate ? `<p class="event-caption">${eventCaption(p)}</p>` : ""}${credits(p)}<div class="place-meta"><span>${icon("clock")}${(p.duration / 60) % 1 ? `${p.duration} min` : `${p.duration / 60} hr`} planning estimate</span><span>${p.provider ? "Live discovery" : p.custom ? "Group discovery" : "Starter pick"}</span></div><div class="place-footer"><button class="text-button" data-action="details" data-id="${esc(p.id)}">View details ${icon("arrow")}</button><button class="button ${proposal ? "soft" : "primary"}" data-action="${proposal ? "show-ideas" : "propose"}" data-id="${esc(p.id)}">${icon(proposal ? "check" : "plus")}${proposal ? "On ideas board" : "Propose to group"}</button></div></div></article>`;
            })
            .join("");
        const html =
            line +
            (cards
                ? `<div class="places-grid">${cards}</div>${places.length > visibleCount ? '<button class="add-stop" data-action="more">Show more places ↓</button>' : ""}`
                : empty(
                      view === "saved"
                          ? "Your wishlist starts here"
                          : category === "Event"
                            ? "Find something fun in the city"
                            : "A little off the beaten path",
                      view === "saved"
                          ? "Tap the heart on a place to keep it for later."
                          : category === "Event"
                            ? "Search city events above, try another date range, or add an event from its organiser’s link."
                            : "Try live discovery, another city or category, or add your own discovery.",
                      `<button class="button secondary" data-action="${view === "saved" ? "show-discover" : "custom"}">${view === "saved" ? "Explore places" : "Add a place or event"}</button>`,
                  ));
        window.PlanmateUtils.replaceHtml($("placeResults"), html, photos);
        updateLiveStatus();
    }
    function renderIdeas() {
        renderers.renderIdeas({ state, memberId });
    }
    function renderItinerary() {
        renderers.renderItinerary({ state, memberId, exportBusy });
    }
    function renderGroup() {
        $("workspace").innerHTML =
            `<div class="section-heading"><div><h2>Good company, great plans</h2><p>Bring everyone’s discoveries into one shared adventure.</p></div></div><div class="info-box"><strong>${groupCode ? "Your shared planning space" : isPreview() ? "You’re exploring a preview group" : "This plan is saved on your browser"}</strong><p>${groupCode ? "Friends with your invitation can join as themselves, propose places, vote and edit the itinerary. Changes refresh every few seconds." : isPreview() ? "Aarav, Riya and Maya are sample planners. Try their perspectives below, or start a shared trip with your own friends." : "Start a shared trip to invite friends on their own devices."}</p>${isPreview() ? `<label for="previewMember">Try the preview as</label><select id="previewMember" class="preview-selector">${state.members.map((m) => `<option value="${esc(m.id)}" ${memberId === m.id ? "selected" : ""}>${esc(m.name)}${m.id === "you" ? " (you)" : " (sample friend)"}</option>`).join("")}</select>` : ""}</div><div class="member-grid">${state.members.map((m, i) => `<div class="member-card">${avatar(m, i)}<div><strong>${esc(m.name)}${m.removed ? " · former member" : ""}${m.id === memberId ? " · you" : ""}</strong><small>${state.proposals.filter((p) => p.by === m.id).length} ideas proposed · ${state.proposals.filter((p) => p.responses[m.id]).length} suggestion responses</small></div></div>`).join("")}</div><div class="group-actions"><button class="button primary" data-action="${groupCode ? "invite" : "new-trip"}">${icon("users")}${groupCode ? "Invite a friend" : "Start a shared trip"}</button><button class="button secondary" data-action="switch-plan">Switch planning space</button></div><div class="info-box" style="margin-top:20px"><strong>One idea → everyone’s say → a time in the itinerary</strong><p>Any member can schedule an idea once the group is ready. Suggestion responses help you decide; it doesn’t automatically book or approve a venue.</p><p>Travel times and costs are your group’s estimates. Confirm availability, opening hours and event tickets with the venue.</p></div>`;
    }
    function renderAside() {
        selectedDay = renderers.renderAside({ state, memberId, selectedDay });
    }
    function showUnknownEstimates() {
        const unknown = state.stops.filter((p) => !p.costKnown).length;
        $("unknownEstimates")?.remove();
        if (unknown)
            $("itineraryAside").insertAdjacentHTML(
                "beforeend",
                `<p id="unknownEstimates" class="plan-notice">${unknown} cost estimate(s) unknown; totals do not establish affordability.</p>`,
            );
    }
    function render() {
        $("entryGuide").hidden = openingShared || !isPreview();
        $("mobileView").disabled = openingShared;
        for (const selector of [
            ".hero",
            ".trip-strip",
            "#planningProgress",
            "#itineraryAside",
            "#draftRecovery",
        ])
            document.querySelector(selector).hidden = openingShared;
        document
            .querySelector(".planning-layout")
            .classList.toggle("opening-shared", openingShared);
        document.querySelectorAll("#sideNav button").forEach((button) => {
            button.disabled = openingShared;
        });
        if (openingShared) {
            $("sidebarTitle").textContent = "Shared invitation";
            document.querySelector(".view-tabs").hidden = true;
            $("workspace").setAttribute("role", "region");
            $("workspace").removeAttribute("aria-labelledby");
            $("workspace").setAttribute("aria-label", "Opening shared plan");
            $("workspace").innerHTML = empty(
                "Your shared planning space",
                sharedOpenMessage,
                '<a class="button secondary" href="dashboard.html">Open my browser plans</a>',
            );
            return;
        }
        draftUI.beforeRender();
        state = C.migrate(state);
        if (!C.dates(state.trip.start, state.trip.end).includes(selectedDay))
            selectedDay = state.trip.start;
        renderHeader();
        if (view === "discover" || view === "saved") renderDiscover();
        else if (view === "ideas") renderIdeas();
        else if (view === "itinerary") renderItinerary();
        else renderGroup();
        renderAside();
        showUnknownEstimates();
        planningUI.render(view);
        draftUI.afterRender();
    }
    function setView(next) {
        if (!Object.hasOwn(views, next)) return;
        view = next;
        if (next === "saved") city = "All";
        else if (city === "All") city = state.trip.city;
        category = "All";
        search = "";
        visibleCount = 6;
        render();
        updateNavigation();
    }
    function navigationContext() {
        return window.PlanmateNavigation.context({
            view,
            day: view === "today" ? planningUI.todayDay?.() : selectedDay,
            group: groupCode,
            space: currentSpace,
        });
    }
    function updateNavigation() {
        window.PlanmateNavigation.update(navigationContext());
    }
    function setSelectedDay(day) {
        if (!C.dates(state.trip.start, state.trip.end).includes(day)) return;
        selectedDay = day;
        render();
        updateNavigation();
    }
    function persistLocal() {
        if (groupCode) return;
        spaces[currentSpace] = { ...spaces[currentSpace], state: C.clone(state), memberId };
        write(SPACE_KEY, spaces);
        setStatus(
            storageOk
                ? isPreview()
                    ? "Preview · saved on this browser"
                    : "Saved on this browser"
                : "Keep this tab open · not saved",
        );
    }
    async function request(path, options = {}) {
        let response;
        try {
            response = await fetch(path, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    ...(groupToken ? { Authorization: `Bearer ${groupToken}` } : {}),
                    ...window.PlanmateAccount.headers(),
                    ...options.headers,
                },
                signal: AbortSignal.timeout(8000),
            });
        } catch {
            throw new Error(
                "Can’t reach the planning server. Start it or reconnect, then try again.",
            );
        }
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error("The planning server isn’t available on this address.");
        }
        if (!response.ok) {
            const error = new Error(data.error || "Could not save this change.");
            error.status = response.status;
            throw error;
        }
        return data;
    }
    async function mutate(type, payload) {
        if (busy) throw new Error("Wait for the current change to finish.");
        busy = true;
        try {
            if (groupCode) {
                setStatus("Saving your change…");
                try {
                    const result = await request(`/api/groups/${groupCode}/commands`, {
                        method: "POST",
                        body: JSON.stringify({ type, payload, revision: state.revision }),
                    });
                    state = result.state;
                    setStatus("Shared · up to date");
                } catch (error) {
                    if (error.status === 409) {
                        await refreshShared(true);
                        draftUI.conflict();
                        throw new Error(
                            "A friend changed the plan. Review the latest version and try again.",
                        );
                    }
                    setStatus("Change not saved · retry when connected");
                    throw error;
                }
            } else {
                state = C.apply(state, { type, payload }, memberId);
                persistLocal();
            }
            render();
        } finally {
            busy = false;
        }
    }
    const openDialog = window.PlanmateUI.openDialog;
    const formError = '<div class="form-error" id="formError" role="alert" hidden></div>';
    const actions = (label) =>
        `<div class="dialog-actions"><button type="button" class="button secondary" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">${label}</button></div>`;
    const field = (label, input, hint = "") => window.PlanmateUI.field(label, input, hint, "form");
    function dayOptions(value, optional = false) {
        return `${optional ? '<option value="">Let the group decide</option>' : ""}${C.dates(
            state.trip.start,
            state.trip.end,
        )
            .map(
                (d, i) =>
                    `<option value="${d}" ${d === value ? "selected" : ""}>Day ${i + 1} · ${fmtDate(d, { weekday: "short", day: "numeric", month: "short" })}</option>`,
            )
            .join("")}`;
    }
    function openPropose(id) {
        const p = findPlace(id);
        if (!p) return;
        if (p.eventDate && (p.eventDate > state.trip.end || p.eventEndDate < state.trip.start))
            return toast(
                "This event is outside your trip dates. Edit the trip dates to include it first.",
            );
        const eventDay = p.eventDate
            ? p.eventDate < state.trip.start
                ? state.trip.start
                : p.eventDate
            : "";
        const days = p.eventDate
            ? C.dates(state.trip.start, state.trip.end)
                  .filter((d) => d >= p.eventDate && d <= p.eventEndDate)
                  .map(
                      (d) =>
                          `<option value="${d}" ${d === eventDay ? "selected" : ""}>${fmtDate(d)}</option>`,
                  )
                  .join("")
            : dayOptions("", true);
        openDialog(
            `What about ${p.name}?`,
            p.eventDate
                ? "Choose one of the event’s actual dates."
                : "Suggest it first. Decide the time together.",
            `<form data-form="propose" data-place="${esc(id)}">${p.provider === "google" ? field("A nickname for this stop (optional)", '<input name="placeLabel" maxlength="100" placeholder="e.g. Our sunset stop">') : ""}${field("Your idea", '<textarea name="note" maxlength="500" placeholder="Why should we go? Any preferred time or booking details?"></textarea>')}${field(p.eventDate ? "Event day" : "Preferred day", `<select name="preferredDate">${days}</select>`)}${formError}${actions("Propose to group")}</form>`,
        );
    }
    function openCustom() {
        openDialog(
            "A discovery of your own",
            "Any place. Any city in India. Any event you’ve found.",
            `<form data-form="custom">${field("Place or event name", '<input name="name" maxlength="100" required placeholder="e.g. A gig, a beach café, a hidden trail">')}<div class="form-row">${field("City", `<input name="city" value="${esc(city === "All" ? state.trip.city : city)}" list="cityNames" maxlength="60" required><datalist id="cityNames">${catalogue.cities.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>`)}${field("Category", `<select name="category">${C.categories.map((c) => `<option value="${c}">${categoryLabel[c]}</option>`).join("")}</select>`)}</div>${field("Area or neighbourhood", '<input name="area" maxlength="100" placeholder="Where in the city?">')}${field("Venue, event or map link (optional)", '<input type="url" name="source" maxlength="1500" placeholder="https://…">')}${field("Preferred day / event date", `<select name="preferredDate">${dayOptions("", true)}</select>`, "For a dated event, choose its actual day. Edit the trip dates first if needed.")}${field("Tell your friends", '<textarea name="note" maxlength="500" placeholder="Timing, price estimate, or why you love this idea…"></textarea>')}${formError}${actions("Share your discovery")}</form>`,
        );
    }
    function openDetails(id) {
        const p = findPlace(id);
        if (!p) return;
        openDialog(
            p.name,
            `${p.area}, ${p.city} · ${categoryLabel[p.category]}`,
            `<div class="dialog-scene">${placeVisual(p)}</div>${credits(p)}${p.eventDate ? `<p class="event-caption">${eventCaption(p)}</p>` : ""}<p class="detail-description">${esc(p.description)}</p><div class="info-box"><strong>A starting point for your plan</strong><p>Allow around ${p.duration} minutes, or choose your own duration. Check current opening hours, entry rules, prices and availability before going.</p></div><div class="detail-links"><a href="${esc(mapsUrl(p))}" target="_blank" rel="noopener noreferrer">Find on Google Maps ↗</a>${p.source ? `<a href="${esc(C.safeUrl(p.source))}" target="_blank" rel="noopener noreferrer">${p.category === "Event" ? "Event / ticket listing" : p.provider === "google" ? "Google Maps listing" : "Venue / tourism guide"} ↗</a>` : ""}</div><div class="dialog-actions"><button class="button secondary" data-action="save-place" data-id="${esc(p.id)}">${saved.includes(p.id) ? "Saved ♥" : "Save for later ♡"}</button><button class="button primary" data-action="propose" data-id="${esc(p.id)}">Propose to group</button></div>`,
        );
    }
    function timeString(m) {
        const safe = Math.max(0, Math.min(1439, m));
        return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
    }
    function openSchedule(id, editing = false) {
        const item = editing
            ? state.stops.find((s) => s.id === id)
            : state.proposals.find((p) => p.id === id && p.status === "pending");
        if (!item) return toast("That idea has already changed. Check the latest plan.");
        const day = item.date || item.preferredDate || selectedDay;
        const sameDay = state.stops.filter((s) => s.date === day);
        const nextStart = sameDay.length
            ? Math.max(...sameDay.map((s) => C.minutes(s.end) + (s.endNextDay ? 1440 : 0))) + 30
            : 540;
        const start =
                item.start ||
                (day === item.place.eventDate && item.place.eventTime) ||
                timeString(nextStart < 1380 ? nextStart : 540),
            endMin = C.minutes(start) + item.place.duration;
        const days = item.place.eventDate
            ? C.dates(state.trip.start, state.trip.end)
                  .filter((d) => d >= item.place.eventDate && d <= item.place.eventEndDate)
                  .map(
                      (d) =>
                          `<option value="${d}" ${d === day ? "selected" : ""}>${fmtDate(d)}</option>`,
                  )
                  .join("")
            : dayOptions(day);
        openDialog(
            editing ? "A little change of plans" : "Give this idea a time",
            displayPlace(item.place).name,
            `<form data-form="${editing ? "edit-stop" : "schedule"}" data-id="${esc(id)}">${field("Day", `<select name="date">${days}</select>`)}<div class="form-row">${field("Start time (${esc(state.trip.timezone)})", `<input type="time" name="start" value="${esc(start)}" required>`)}${field("End time (${esc(state.trip.timezone)})", `<input type="time" name="end" value="${esc(item.end || timeString(endMin % 1440))}" required>`)}</div><label class="checkbox-field"><input type="checkbox" name="endNextDay" ${item.endNextDay || (!editing && endMin >= 1440) ? "checked" : ""}>Ends the next day (for late nights)</label><div class="form-row">${field("Travel time before (min)", `<input type="number" name="travel" min="0" max="240" step="1" value="${item.travel ?? 30}" required>`)}${field("Estimated cost / person (₹)", `<input type="number" name="cost" min="0" max="1000000" step="1" value="${item.cost ?? 0}" required>`)}</div>${field("Notes for the group", `<textarea name="note" maxlength="500" placeholder="Meeting point, reservations, things to bring…">${esc(item.note || "")}</textarea>`, "Travel buffers are manual estimates. Overlapping stops will be flagged.")}${formError}${actions(editing ? "Save changes" : "Add to itinerary")}</form>`,
        );
    }
    function openTrip(editing = false, destination = "") {
        const t = editing ? state.trip : defaultTrip();
        if (!editing && destination) {
            t.city = destination.trim().slice(0, 60);
            t.title = `${t.city}, here we come`.slice(0, 100);
        }
        openDialog(
            editing ? "Make it your kind of trip" : "A new adventure starts here",
            editing
                ? "Change the dates, destination or budget together."
                : "Give your next plan a name and invite your people.",
            `<form data-form="${editing ? "edit-trip" : "new-trip"}">${field("Trip name", `<input name="title" value="${esc(t.title)}" maxlength="100" required>`)}${field("Main destination", `<input name="city" value="${esc(t.city)}" maxlength="60" list="tripCities" required><datalist id="tripCities">${catalogue.cities.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>`)}<div class="form-row">${field("First day", `<input type="date" name="start" value="${t.start}" required>`)}${field("Last day", `<input type="date" name="end" value="${t.end}" required>`)}</div>${field("Whole-trip budget per person (₹)", `<input type="number" name="budget" min="0" max="1000000" step="1" value="${t.budget}" required>`)}${!editing ? `${field("Your name", `<input name="name" value="${esc(profileName)}" maxlength="60" required>`)}<label class="checkbox-field"><input name="shared" type="checkbox" ${serverAvailable ? "checked" : "disabled"}>Shared plan · Friends can join on their own devices</label>${!serverAvailable ? '<div class="info-box">Start the local planning server to enable shared trips. You can create a browser-only plan now.</div>' : ""}` : ""}${formError}${actions(editing ? "Save trip details" : "Create planning space")}</form>`,
        );
    }
    function inviteUrl() {
        const params = new URLSearchParams({ group: groupCode });
        if (sessions[groupCode]?.invite) params.set("invite", sessions[groupCode].invite);
        return `${location.origin}${location.pathname}?${params}`;
    }
    function openInvite() {
        if (!groupCode)
            return openDialog(
                "Plans are better together",
                "Start a shared space for your friends.",
                `<div class="info-box"><strong>${serverAvailable ? "Ready for your own group" : "Shared planning needs the local server"}</strong><p>${serverAvailable ? "Create a shared trip, then send its invitation link to your friends. Each person joins with their own name." : "Run npm start in the project folder, then open http://localhost:3000. Your browser-only preview stays saved."}</p></div><div class="dialog-actions"><button class="button primary" data-action="new-trip">Start a new trip ${icon("arrow")}</button></div>`,
            );
        openDialog(
            "Bring your people",
            "Invitations expire after seven days. The organizer can replace or revoke the link.",
            `${sessions[groupCode]?.invite ? `<div class="invite-link">${esc(inviteUrl())}</div><button class="button primary" data-action="copy-invite">Copy invitation</button>` : "<p>No invitation link is saved on this device.</p>"}<div class="info-box"><p>For another device, use the server's reachable address. Account trips require verified sign-in. Replacing an invitation invalidates the previous link.</p></div>${state.organizerId === memberId ? '<div class="dialog-actions"><button class="button secondary" data-action="rotate-invite">Create a new invitation</button><button class="button secondary" data-action="revoke-invite">Revoke invitations</button></div>' : "<p>Ask the organizer for the current invitation.</p>"}`,
        );
    }
    function openSwitch() {
        openDialog(
            "Which adventure next?",
            "Your saved and shared planning spaces.",
            `<div class="group-actions">${Object.entries(spaces)
                .filter(([, entry]) => validStored(entry))
                .map(
                    ([id, entry]) =>
                        `<button class="button secondary" data-local-space="${esc(id)}">${esc(entry.state.trip.title)}${entry.preview ? " · preview" : ""}</button>`,
                )
                .join("")}${Object.entries(sessions)
                .map(
                    ([code, session]) =>
                        `<button class="button secondary" data-shared-space="${esc(code)}">${esc(session.title || "Shared trip")}</button>`,
                )
                .join(
                    "",
                )}</div><div class="dialog-actions" style="margin-top:20px"><button class="button primary" data-action="new-trip">+ Start a new adventure</button></div>`,
        );
    }
    async function exportPlan() {
        if (exportBusy) return;
        const snapshot = C.clone(state),
            stops = C.clone(displayStops()),
            preview = isPreview();
        exportBusy = true;
        if (view === "itinerary") render();
        try {
            const bytes = await window.PlanmateExport.createPdf(snapshot, { stops, preview });
            window.PlanmateExport.download(bytes, snapshot.trip.title);
            toast("Your PDF itinerary is ready to share.");
        } finally {
            exportBusy = false;
            if (view === "itinerary") render();
        }
    }
    const sharedSync = window.PlanmateSync.create({
        context: () => ({ code: groupCode, member: memberId }),
        busy: () => busy,
        revision: () => state.revision,
        request,
        receive: (next) => {
            state = next;
            render();
        },
        status: setStatus,
        error: (error) => {
            setStatus(
                error.status === 401
                    ? "Trip access unavailable"
                    : "Connection interrupted · changes paused",
            );
            if (error.status === 401) {
                openingShared = true;
                sharedOpenMessage = error.message;
                render();
            }
        },
    });
    const refreshShared = sharedSync.refresh;
    async function activateShared(code) {
        const session = sessions[code];
        if (!session?.token && !window.PlanmateAccount.account()) return openJoin(code);
        const previousToken = groupToken;
        groupToken = session?.token || "";
        try {
            const result = await request(`/api/groups/${encodeURIComponent(code)}`);
            groupCode = code;
            openingShared = false;
            currentSpace = null;
            state = result.state;
            memberId = result.memberId || session?.memberId;
            city = state.trip.city;
            selectedDay =
                code === incomingGroup &&
                C.dates(state.trip.start, state.trip.end).includes(requestedDay)
                    ? requestedDay
                    : state.trip.start;
            render();
            updateNavigation();
            setStatus("Shared · up to date");
        } catch (error) {
            groupToken = previousToken;
            if (error.status === 401) openJoin(code);
            else toast(error.message);
            if (openingShared) {
                sharedOpenMessage = `${error.message} Check the invitation and reload to try again.`;
                render();
            }
        }
    }
    function openJoin(code) {
        openDialog(
            "Your friends saved you a spot",
            "Join their trip and bring your own ideas.",
            `<p><a href="login.html?${esc(new URLSearchParams({ group: code, ...(navigation.get("invite") ? { invite: navigation.get("invite") } : {}) }))}">Sign in for account access</a></p><form data-form="join" data-code="${esc(code)}">${field("What should your friends call you?", `<input name="name" value="${esc(profileName === "You" ? "" : profileName)}" placeholder="Your name" maxlength="60" required>`)}<div class="info-box"><p>Account trips require sign-in. A local demo invitation joins an unverified demo member.</p></div>${formError}${actions("Join the planning space")}</form>`,
        );
    }
    document.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || button.disabled) return;
        try {
            if (
                busy &&
                (button.dataset.localSpace ||
                    button.dataset.sharedSpace ||
                    ["new-trip", "switch-plan"].includes(button.dataset.action))
            )
                return toast("Let this change finish before switching trips.");
            if (button.dataset.view) return setView(button.dataset.view);
            if (button.dataset.category) {
                category = button.dataset.category;
                visibleCount = 6;
                renderDiscover();
                return;
            }
            if (button.dataset.day) {
                setSelectedDay(button.dataset.day);
                return;
            }
            if (button.dataset.localSpace) {
                activateLocal(button.dataset.localSpace);
                $("appDialog").close();
                setView("discover");
                persistLocal();
                return;
            }
            if (button.dataset.sharedSpace) {
                $("appDialog").close();
                await activateShared(button.dataset.sharedSpace);
                return;
            }
            const id = button.dataset.id;
            switch (button.dataset.action || (button.id === "switchPlan" ? "switch-plan" : "")) {
                case "close-dialog":
                    $("appDialog").close();
                    break;
                case "details":
                    openDetails(id);
                    break;
                case "propose":
                    openPropose(id);
                    break;
                case "custom":
                    openCustom();
                    break;
                case "schedule":
                    openSchedule(id);
                    break;
                case "edit-stop":
                    openSchedule(id, true);
                    break;
                case "new-trip":
                    openTrip();
                    break;
                case "open-join":
                    openDialog(
                        "Join your friends",
                        "Paste the invitation link your organizer shared.",
                        `<form data-form="join-link">${field("Invitation link or trip code", '<input name="link" required maxlength="1000" autocomplete="off">')}${formError}${actions("Open invitation")}</form>`,
                    );
                    break;
                case "edit-trip":
                    openTrip(true);
                    break;
                case "invite":
                    openInvite();
                    break;
                case "rotate-invite":
                case "revoke-invite": {
                    const result = await request(`/api/groups/${groupCode}/invite`, {
                        method: "POST",
                        body: JSON.stringify({
                            action: button.dataset.action === "rotate-invite" ? "rotate" : "revoke",
                            revision: state.revision,
                        }),
                    });
                    state = result.state;
                    sessions[groupCode] ||= { memberId, title: state.trip.title };
                    sessions[groupCode].invite = result.invite;
                    write(SESSION_KEY, sessions);
                    render();
                    openInvite();
                    toast(
                        result.invite
                            ? "New invitation ready. Previous links are revoked."
                            : "Invitations revoked. Current members retain access.",
                    );
                    break;
                }
                case "claim-membership":
                    openDialog(
                        "Bind your legacy membership",
                        "Your existing membership token proves access. Matching a local email does not claim an account.",
                        `<form data-form="claim-membership"><label class="checkbox-field"><input name="consent" type="checkbox" required>Bind my current member identity and its history to this verified account. This revokes the old browser token.</label>${formError}${actions("Bind my membership")}</form>`,
                    );
                    break;
                case "switch-plan":
                    openSwitch();
                    break;
                case "show-ideas":
                    setView("ideas");
                    break;
                case "show-discover":
                    setView("discover");
                    break;
                case "more":
                    visibleCount += 6;
                    renderResults();
                    break;
                case "live-search":
                    await loadLive();
                    break;
                case "live-more":
                    await loadLive(true);
                    break;
                case "refresh-saved":
                    await refreshSavedDetails();
                    break;
                case "export":
                    await exportPlan();
                    break;
                case "save-place": {
                    saved = saved.includes(id) ? saved.filter((p) => p !== id) : [...saved, id];
                    if (saved.includes(id)) {
                        const place = findPlace(id);
                        if (place) savedRecords.set(id, C.place(place));
                    } else savedRecords.delete(id);
                    write(SAVED_KEY, saved);
                    write(SAVED_RECORDS_KEY, [...savedRecords.values()]);
                    if (view === "discover" || view === "saved") renderResults();
                    if (
                        $("appDialog").open &&
                        $("dialogContent").querySelector('[data-action="save-place"]')
                    )
                        openDetails(id);
                    toast(
                        saved.includes(id)
                            ? "Saved to your little wishlist."
                            : "Removed from saved places.",
                    );
                    break;
                }
                case "vote":
                    await mutate("vote", { id });
                    break;
                case "remove-stop":
                    openDialog(
                        "Back to the ideas board?",
                        "This removes the time slot and keeps the group’s idea and votes.",
                        `<div class="dialog-actions"><button class="button secondary" data-action="close-dialog">Keep stop</button><button class="button danger" data-action="confirm-remove-stop" data-id="${esc(id)}">Remove from itinerary</button></div>`,
                    );
                    break;
                case "confirm-remove-stop":
                    await mutate("removeStop", { id });
                    $("appDialog").close();
                    toast("The place is back on the ideas board.");
                    break;
                case "remove-idea":
                    await mutate("removeIdea", { id });
                    toast("Your idea was removed.");
                    break;
                case "copy-invite":
                    try {
                        await navigator.clipboard.writeText(inviteUrl());
                        toast("Invitation copied. Send it to your friends.");
                    } catch {
                        toast("Copy the invitation link shown above.");
                    }
                    break;
            }
        } catch (error) {
            toast(error.message);
        }
    });
    document.addEventListener("input", (event) => {
        if (event.target.id === "placeSearch") {
            search = event.target.value;
            visibleCount = 6;
            renderResults();
        }
    });
    document.addEventListener("change", (event) => {
        if (event.target.id === "browseCity") {
            city = event.target.value;
            visibleCount = 6;
            liveContext = null;
            renderResults();
        }
        if (event.target.id === "eventFrom") {
            eventFrom = event.target.value;
            renderResults();
        }
        if (event.target.id === "eventTo") {
            eventTo = event.target.value;
            renderResults();
        }
        if (event.target.id === "eventType") {
            eventType = event.target.value;
            renderResults();
        }
        if (event.target.id === "previewMember" && isPreview()) {
            memberId = event.target.value;
            persistLocal();
            render();
            toast(`Previewing as ${memberName(memberId)}.`);
        }
        if (event.target.id === "mobileView") setView(event.target.value);
    });
    document.addEventListener(
        "error",
        (event) => {
            if (
                event.target instanceof HTMLImageElement &&
                event.target.classList.contains("venue-photo")
            )
                event.target.remove();
        },
        true,
    );
    document.addEventListener("keydown", (event) => {
        if (event.target.id === "placeSearch" && event.key === "Enter") {
            event.preventDefault();
            if (view === "discover") loadLive();
        }
    });
    document.querySelector(".view-tabs").addEventListener("keydown", (event) => {
        const tabs = [...document.querySelectorAll('[role="tab"]')],
            index = tabs.indexOf(event.target);
        if (index < 0) return;
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        setView(tabs[next].dataset.view);
        tabs[next].focus();
    });
    document.addEventListener("submit", async (event) => {
        const form = event.target;
        if (!form.dataset.form) return;
        event.preventDefault();
        if (busy) return;
        const data = Object.fromEntries(new FormData(form)),
            submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        $("formError").hidden = true;
        const changingSpace = ["new-trip", "join"].includes(form.dataset.form);
        if (changingSpace) busy = true;
        try {
            switch (form.dataset.form) {
                case "propose":
                    await mutate("propose", {
                        id: uid(),
                        place: {
                            ...findPlace(form.dataset.place),
                            ...(data.placeLabel ? { label: data.placeLabel } : {}),
                        },
                        note: data.note,
                        preferredDate: data.preferredDate,
                    });
                    setView("ideas");
                    toast("Your idea is on the board. Let’s hear from the group.");
                    break;
                case "custom": {
                    const p = C.place({
                        id: uid(),
                        name: data.name,
                        city: data.city,
                        area: data.area || data.city,
                        category: data.category,
                        source: data.source,
                        note: data.note,
                        custom: true,
                    });
                    await mutate("propose", {
                        id: uid(),
                        place: p,
                        note: data.note,
                        preferredDate: data.preferredDate,
                    });
                    setView("ideas");
                    toast("Your discovery is ready for the group.");
                    break;
                }
                case "schedule":
                case "edit-stop": {
                    const editing = form.dataset.form === "edit-stop";
                    await mutate(editing ? "editStop" : "schedule", {
                        id: editing ? form.dataset.id : uid(),
                        proposalId: form.dataset.id,
                        date: data.date,
                        start: data.start,
                        end: data.end,
                        endNextDay: Boolean(data.endNextDay),
                        travel: Number(data.travel),
                        cost: Number(data.cost),
                        costKnown: Boolean(data.costKnown),
                        note: data.note,
                    });
                    selectedDay = data.date;
                    setView("itinerary");
                    toast(
                        editing
                            ? "The itinerary has been updated."
                            : "One more good idea in the plan.",
                    );
                    break;
                }
                case "edit-trip":
                    await mutate("updateTrip", {
                        ...data,
                        timezone: state.trip.timezone,
                        budget: Number(data.budget),
                    });
                    city = state.trip.city;
                    render();
                    toast("Your trip details are updated.");
                    break;
                case "new-trip": {
                    const trip = C.validateTrip({ ...data, budget: Number(data.budget) });
                    const name = C.text(data.name, "Name", 60);
                    if (data.shared) {
                        const result = await request("/api/groups", {
                            method: "POST",
                            body: JSON.stringify({ trip, name }),
                        });
                        groupCode = result.code;
                        groupToken = result.token;
                        memberId = result.memberId;
                        state = result.state;
                        sessions[groupCode] = {
                            token: groupToken,
                            memberId,
                            title: trip.title,
                            invite: result.invite,
                        };
                        write(SESSION_KEY, sessions);
                        currentSpace = null;
                        history.replaceState(
                            {},
                            "",
                            `${location.pathname}?group=${encodeURIComponent(groupCode)}`,
                        );
                        setStatus("Shared · up to date");
                    } else {
                        const id = uid();
                        spaces[id] = {
                            state: C.createState(trip, { id: uid(), name }),
                            memberId: "",
                            preview: false,
                        };
                        spaces[id].memberId = spaces[id].state.members[0].id;
                        write(SPACE_KEY, spaces);
                        activateLocal(id);
                        persistLocal();
                    }
                    city = trip.city;
                    selectedDay = trip.start;
                    openingShared = false;
                    setView("group");
                    toast(
                        data.shared
                            ? "Your shared space is ready. Invite your friends."
                            : "Your new adventure is ready.",
                    );
                    break;
                }
                case "claim-membership": {
                    const result = await request(`/api/groups/${groupCode}/claim`, {
                        method: "POST",
                        body: JSON.stringify({
                            consent: data.consent === "on",
                            revision: state.revision,
                        }),
                    });
                    state = result.state;
                    groupToken = "";
                    sessions[groupCode] = { memberId: result.memberId, title: state.trip.title };
                    write(SESSION_KEY, sessions);
                    render();
                    toast("Membership bound to your verified account. History is preserved.");
                    break;
                }
                case "join-link": {
                    const link = data.link.trim();
                    const u = new URL(link, location.href);
                    const code = /^[A-Za-z0-9_-]{16}$/.test(link)
                        ? link
                        : u.searchParams.get("group");
                    C.check(
                        /^[A-Za-z0-9_-]{16}$/.test(code || ""),
                        "Use a Planmate invitation link or its trip code.",
                    );
                    const params = new URLSearchParams({ group: code });
                    if (/^[A-Za-z0-9_-]{32}$/.test(u.searchParams.get("invite") || ""))
                        params.set("invite", u.searchParams.get("invite"));
                    location.href = `dashboard.html?${params}`;
                    return;
                }
                case "join": {
                    const result = await request(
                        `/api/groups/${encodeURIComponent(form.dataset.code)}/join`,
                        {
                            method: "POST",
                            body: JSON.stringify({
                                name: data.name,
                                invite: navigation.get("invite") || "",
                            }),
                        },
                    );
                    groupCode = result.code;
                    openingShared = false;
                    groupToken = result.token;
                    memberId = result.memberId;
                    state = result.state;
                    currentSpace = null;
                    sessions[groupCode] = { token: groupToken, memberId, title: state.trip.title };
                    write(SESSION_KEY, sessions);
                    city = state.trip.city;
                    selectedDay = C.dates(state.trip.start, state.trip.end).includes(requestedDay)
                        ? requestedDay
                        : state.trip.start;
                    history.replaceState(
                        {},
                        "",
                        `${location.pathname}?group=${encodeURIComponent(groupCode)}`,
                    );
                    setView(navigation.has("view") ? requestedView : "group");
                    setStatus("Shared · up to date");
                    toast(
                        "You've joined the planning space. Share your availability and attendance.",
                    );
                    break;
                }
            }
            document.dispatchEvent(new CustomEvent("planmate:form-saved", { detail: { form } }));
            $("appDialog").close();
        } catch (error) {
            const box = $("formError");
            if (box) {
                box.textContent = error.message;
                box.hidden = false;
            } else toast(error.message);
        } finally {
            submit.disabled = false;
            if (changingSpace) busy = false;
        }
    });
    window.addEventListener("storage", (event) => {
        if ([window.PlanmateProfile.KEY, "PlanmateUser", "plansyncUser"].includes(event.key)) {
            const previousName = profileName;
            profileName = window.PlanmateProfile.load().name;
            for (const entry of Object.values(spaces)) {
                if (!validStored(entry)) continue;
                const own = entry.state.members.find(
                    (m) => m.id === (entry.preview ? "you" : entry.memberId),
                );
                if (own?.name === previousName) own.name = profileName;
            }
            if (!groupCode && validStored(spaces[currentSpace]))
                state = C.clone(spaces[currentSpace].state);
            write(SPACE_KEY, spaces);
            write("planmateLastProfileV1", profileName);
            renderHeader();
            if (!groupCode && view === "group") render();
        }
        if (event.key === SAVED_KEY) {
            saved = read(SAVED_KEY, []);
            render();
        }
        if (event.key === SPACE_KEY && !groupCode && !busy) {
            spaces = read(SPACE_KEY, {});
            if (validStored(spaces[currentSpace])) {
                state = C.clone(spaces[currentSpace].state);
                render();
            }
        }
    });
    async function init() {
        await window.PlanmateAccount.ready;
        profileName = window.PlanmateProfile.load().name;
        if (window.PlanmateAccount.account()) {
            try {
                const result = await request("/api/my-trips");
                for (const trip of result.trips)
                    sessions[trip.code] = {
                        ...sessions[trip.code],
                        memberId: trip.memberId,
                        title: trip.title,
                    };
                write(SESSION_KEY, sessions);
            } catch (error) {
                toast(error.message);
            }
        }
        render();
        setStatus(
            openingShared
                ? "Opening shared plan…"
                : isPreview()
                  ? "Preview · saved on this browser"
                  : "Saved on this browser",
        );
        if (location.protocol === "file:") {
            if (openingShared) {
                sharedOpenMessage =
                    "Shared invitations need the planning server. Run npm start and open this invitation through its server address.";
                render();
                setStatus("Shared plan needs the server");
            }
            if (requestedPlanCity) openTrip(false, requestedPlanCity);
            return;
        }
        try {
            await request("/api/health");
            serverAvailable = true;
        } catch {
            serverAvailable = false;
        }
        if (serverAvailable) {
            try {
                liveConfig = await request("/api/discovery/config");
            } catch {
                /* Starter discovery remains available. */
            }
            render();
        }
        const code = incomingGroup;
        if (code) {
            if (serverAvailable) await activateShared(code);
            else {
                sharedOpenMessage =
                    "The shared planning server is unavailable. Start it at this address, then reload to open the group.";
                render();
                setStatus("Shared plan unavailable · reload to retry");
            }
        }
        if (requestedPlanCity && !$("appDialog").open) openTrip(false, requestedPlanCity);
        sharedSync.start();
    }
    const draftUI = window.PlanmateDrafts.init({
        context: () => ({
            owner: window.PlanmateProfile.identity(),
            space: groupCode || currentSpace,
            member: memberId,
        }),
        state: () => state,
        view: () => view,
        render,
        toast,
        open: (d) => {
            if (d.source === "form") {
                if (d.kind === "edit-trip") openTrip(true);
                else if (["schedule", "edit-stop"].includes(d.kind))
                    openSchedule(d.id, d.kind === "edit-stop");
                else if (d.kind === "custom") openCustom();
                else if (d.kind === "propose") openPropose(d.id);
                return;
            }
            const actions = {
                estimate: ["fit", "estimate"],
                "choose-date": ["group", "choose-date"],
                coordinates: ["itinerary", "coordinates"],
                "edit-comment": ["ideas", "edit-comment"],
                expense: ["expenses", d.id ? "edit-expense" : "add-expense"],
                repayment: ["expenses", "add-repayment"],
                caption: ["scrapbook", "edit-caption"],
                upload: ["scrapbook", "upload"],
            };
            if (d.kind === "preferences") return setView("fit");
            if (["availability", "add-date"].includes(d.kind)) return setView("group");
            if (d.kind === "comment") {
                setView("ideas");
                [...document.querySelectorAll("[data-proposal-id]")]
                    .find((p) => p.dataset.proposalId === d.id)
                    ?.querySelector("details")
                    ?.setAttribute("open", "");
                return;
            }
            const action = actions[d.kind];
            if (action) {
                setView(action[0]);
                [...document.querySelectorAll("[data-plan-action]")]
                    .find(
                        (b) =>
                            b.dataset.planAction === action[1] && (!d.id || b.dataset.id === d.id),
                    )
                    ?.click();
            }
        },
    });
    const planningUI = window.GroupPlanning.init({
        state: () => state,
        memberId: () => memberId,
        groupCode: () => groupCode,
        memberName,
        mutate,
        toast,
        openDialog,
        closeDialog: () => $("appDialog").close(),
        money,
        mapsUrl,
        displayPlace,
        allPlaces,
        request,
        setView,
        blobRequest: async (url, options = {}) => {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...(groupToken ? { Authorization: `Bearer ${groupToken}` } : {}),
                    ...options.headers,
                },
                signal: AbortSignal.timeout(20000),
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Media unavailable.");
            }
            return response.blob();
        },
        uploadPhoto: async (file, params) => {
            if (!groupCode) throw new Error("Start a shared trip to upload photos.");
            if (busy) throw new Error("Wait for your current change to finish.");
            busy = true;
            setStatus("Uploading your photo…");
            try {
                const response = await fetch(
                    `/api/groups/${groupCode}/photos?${new URLSearchParams({ ...params, revision: String(state.revision) })}`,
                    {
                        method: "POST",
                        headers: {
                            ...(groupToken ? { Authorization: `Bearer ${groupToken}` } : {}),
                            ...window.PlanmateAccount.headers(),
                            "Content-Type": file.type,
                        },
                        body: file,
                        signal: AbortSignal.timeout(30000),
                    },
                );
                const data = await response.json();
                if (!response.ok) {
                    if (response.status === 409) await refreshShared(true);
                    throw new Error(data.error || "Photo upload failed.");
                }
                state = data.state;
                render();
                setStatus("Shared · up to date");
            } catch (error) {
                setStatus("Photo not saved · retry when connected");
                throw error;
            } finally {
                busy = false;
            }
        },
        selectedDay: () => selectedDay,
        setSelectedDay,
        initialTodayDay: () =>
            requestedView === "today" && (!incomingGroup || groupCode === incomingGroup)
                ? requestedDay
                : "",
    });
    const renderers = window.PlanmateRenderers.init({
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
    });
    init();
})();
