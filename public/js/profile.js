(async () => {
    "use strict";
    const P = window.PlanmateProfile,
        $ = (id) => document.getElementById(id);
    const { escapeHtml: escape, uniqueId } = window.PlanmateUtils;
    const icon = (id) => `<svg aria-hidden="true"><use href="#p-${id}"/></svg>`;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const params = new URLSearchParams(location.search),
        requestedGroup = params.get("group") || "";
    const group = /^[A-Za-z0-9_-]{16}$/.test(requestedGroup) ? requestedGroup : "";
    const returnParams = new URLSearchParams();
    if (group) returnParams.set("group", group);
    else if (/^[A-Za-z0-9_-]{1,100}$/.test(params.get("space") || ""))
        returnParams.set("space", params.get("space"));
    if (
        [
            "group",
            "fit",
            "discover",
            "ideas",
            "itinerary",
            "today",
            "expenses",
            "scrapbook",
            "saved",
        ].includes(params.get("view"))
    )
        returnParams.set("view", params.get("view"));
    const requestedDay = params.get("day") || "";
    if (
        /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) &&
        !Number.isNaN(Date.parse(`${requestedDay}T12:00:00Z`)) &&
        new Date(`${requestedDay}T12:00:00Z`).toISOString().slice(0, 10) === requestedDay
    )
        returnParams.set("day", requestedDay);
    let context = {};
    try {
        context = JSON.parse(sessionStorage.getItem("planmateProfileContext") || "{}");
    } catch {
        /* Optional navigation context. */
    }
    const fallbackName =
        group && context?.group === group && typeof context.name === "string"
            ? context.name
            : "You";
    const backUrl = `dashboard.html${returnParams.size ? `?${returnParams}` : ""}`;
    $("backToPlan").href = backUrl;
    $("profileBrand").href = backUrl;
    await window.PlanmateAccount?.ready;
    const identityAtLoad = P.identity();
    let saved = P.load(fallbackName),
        draft = clone(saved),
        extraHobbies = saved.hobbies.filter((h) => !P.hobbies.includes(h));
    let dirty = false,
        saving = false,
        toastTimer,
        pendingNavigation = "";
    function toast(message) {
        clearTimeout(toastTimer);
        $("profileToast").textContent = message;
        $("profileToast").classList.add("show");
        toastTimer = setTimeout(() => $("profileToast").classList.remove("show"), 4500);
    }
    function collect() {
        return P.normalise({
            ...draft,
            name: $("displayName").value,
            homeCity: $("homeCity").value,
            bio: $("travelBio").value,
            hobbies: [...document.querySelectorAll('[name="hobby"]:checked')].map((i) => i.value),
            placeTypes: [...document.querySelectorAll('[name="placeType"]:checked')].map(
                (i) => i.value,
            ),
            colour: document.querySelector('[name="colour"]:checked')?.value || draft.colour,
            pace: $("travelPace").value,
            budget: $("budgetStyle").value,
            company: $("travelCompany").value,
            time: $("exploreTime").value,
        });
    }
    function comparable(value) {
        const copy = clone(value);
        delete copy.updatedAt;
        return JSON.stringify(copy);
    }
    function updateSummary() {
        const value = collect(),
            name = $("displayName").value.trim() || "Your name";
        $("identityName").textContent = name;
        $("identityAvatar").textContent = name
            .split(/\s+/)
            .slice(0, 2)
            .map((s) => s[0])
            .join("")
            .toUpperCase();
        $("identityAvatar").className = `profile-avatar ${value.colour}`;
        $("identityCity").innerHTML = value.homeCity
            ? `${icon("pin")}${escape(value.homeCity)}`
            : "Where’s home for you?";
        $("identityBio").textContent = value.bio || "A few words about your kind of adventure.";
        $("wishCount").textContent = draft.wishlist.filter((w) => !w.visited).length;
        $("visitedCount").textContent = draft.wishlist.filter((w) => w.visited).length;
        $("interestCount").textContent = value.hobbies.length;
        $("paceSummary").textContent = P.options.pace[value.pace];
        $("bioCount").textContent = `${$("travelBio").value.length} / 300`;
        dirty = comparable(value) !== comparable(saved);
        $("profileSaveStatus").textContent = dirty
            ? "A few new things about you · unsaved changes"
            : saved.updatedAt
              ? "Your profile is saved on this browser"
              : "Make it yours, then save your profile";
        document.querySelector(".profile-savebar").classList.toggle("dirty", dirty);
        $("discardChanges").disabled = !dirty || saving;
    }
    function renderHobbies() {
        const choices = [...new Set([...P.hobbies, ...extraHobbies, ...draft.hobbies])];
        $("hobbyChoices").innerHTML = choices
            .map(
                (h) =>
                    `<label class="hobby-chip"><input type="checkbox" name="hobby" value="${escape(h)}" ${draft.hobbies.includes(h) ? "checked" : ""}><span>${escape(h)}</span></label>`,
            )
            .join("");
    }
    function renderWishlist() {
        $("wishlistTotal").textContent =
            `${draft.wishlist.length} ${draft.wishlist.length === 1 ? "city" : "cities"}`;
        $("wishlistCards").innerHTML = draft.wishlist.length
            ? draft.wishlist
                  .map(
                      (w) =>
                          `<article class="wish-card ${w.visited ? "visited" : ""}" data-wish="${escape(w.id)}"><div class="wish-header"><span class="wish-city-icon">${icon("pin")}</span><h3>${escape(w.city)}</h3><span class="status-tag" data-visited-status ${w.visited ? "" : "hidden"}>Been there ✓</span><button type="button" class="icon-button" data-remove-wish="${escape(w.id)}" aria-label="Remove ${escape(w.city)} from wishlist">${icon("close")}</button></div><div class="form-row"><label class="form-field"><span>When’s the dream?</span><select data-wish-field="priority" aria-label="Priority for ${escape(w.city)}"><option value="someday" ${w.priority === "someday" ? "selected" : ""}>Someday, for sure</option><option value="soon" ${w.priority === "soon" ? "selected" : ""}>Next on my list</option><option value="this-year" ${w.priority === "this-year" ? "selected" : ""}>This year, hopefully</option></select></label><label class="form-field"><span>A month in mind (optional)</span><input type="month" data-wish-field="month" value="${escape(w.month)}" aria-label="Target month for ${escape(w.city)}"></label></div><label class="form-field"><span>What’s calling you there?</span><textarea data-wish-field="note" maxlength="200" rows="2" aria-label="Notes for ${escape(w.city)}" placeholder="A festival, a favourite café, a place you’ve always wanted to see…">${escape(w.note)}</textarea></label><div class="wish-actions"><label class="checkbox-field"><input type="checkbox" data-wish-field="visited" ${w.visited ? "checked" : ""}>I’ve made it there</label><button type="button" class="button secondary" data-plan-wish="${escape(w.id)}">${icon("route")}Plan a trip</button></div></article>`,
                  )
                  .join("")
            : `<div class="wishlist-empty">${icon("heart")}<h3>A whole country of possibilities</h3><p>Add that city you keep talking about visiting.<br>We’ll keep a little space for the dream.</p></div>`;
        const suggestions = ["Goa", "Jaipur", "Kochi", "Udaipur", "Rishikesh"].filter(
            (c) => !draft.wishlist.some((w) => w.city.toLowerCase() === c.toLowerCase()),
        );
        $("wishlistSuggestions").innerHTML = suggestions.length
            ? `<span>A little inspiration:</span>${suggestions.map((c) => `<button type="button" data-suggest-city="${escape(c)}">+ ${escape(c)}</button>`).join("")}`
            : "";
    }
    function renderForm() {
        $("displayName").value = draft.name;
        $("homeCity").value = draft.homeCity;
        $("travelBio").value = draft.bio;
        $("avatarColours").innerHTML = P.colours
            .map(
                (c) =>
                    `<label class="colour-option"><input type="radio" name="colour" value="${c}" aria-label="${c[0].toUpperCase() + c.slice(1)} avatar" ${c === draft.colour ? "checked" : ""}><span class="colour-dot ${c}" aria-hidden="true"></span></label>`,
            )
            .join("");
        renderHobbies();
        $("placePreferences").innerHTML = P.places
            .map(
                (p) =>
                    `<label class="place-option"><input type="checkbox" name="placeType" value="${p.id}" ${draft.placeTypes.includes(p.id) ? "checked" : ""}><span>${icon(p.icon)}<span><strong>${p.name}</strong><small>${p.note}</small></span><span class="place-selected" aria-hidden="true"></span></span></label>`,
            )
            .join("");
        for (const [id, key] of [
            ["travelPace", "pace"],
            ["budgetStyle", "budget"],
            ["travelCompany", "company"],
            ["exploreTime", "time"],
        ])
            $(id).innerHTML = Object.entries(P.options[key])
                .map(
                    ([value, label]) =>
                        `<option value="${value}" ${draft[key] === value ? "selected" : ""}>${label}</option>`,
                )
                .join("");
        const cities = [
            ...new Set(
                [
                    ...window.PlannerCatalogue.cities,
                    "Shillong",
                    ...draft.wishlist.map((w) => w.city),
                    draft.homeCity,
                ].filter(Boolean),
            ),
        ];
        $("profileCityNames").innerHTML = cities
            .map((c) => `<option value="${escape(c)}">`)
            .join("");
        const account = P.account(),
            details = [
                ["Email", account.email],
                ["Contact", account.contact],
            ].filter(([, value]) => typeof value === "string" && value);
        $("accountDetails").hidden = !details.length;
        $("accountDetails").innerHTML = details
            .map(([label, value]) => `<span><small>${label}</small>${escape(value)}</span>`)
            .join("");
        renderWishlist();
        updateSummary();
    }
    function addHobby() {
        const value = $("customHobby").value.trim();
        $("hobbyFeedback").textContent = "";
        if (!value) {
            $("hobbyFeedback").textContent = "Tell us a hobby first.";
            return $("customHobby").focus();
        }
        draft = collect();
        const match = [...P.hobbies, ...extraHobbies, ...draft.hobbies].find(
            (h) => h.toLocaleLowerCase() === value.toLocaleLowerCase(),
        );
        if (match && draft.hobbies.includes(match)) {
            $("hobbyFeedback").textContent = "That hobby is already picked.";
            return;
        }
        if (draft.hobbies.length >= 20) {
            $("hobbyFeedback").textContent = "Choose up to 20 hobbies.";
            return;
        }
        const hobby = match || value;
        if (!P.hobbies.includes(hobby) && !extraHobbies.includes(hobby)) extraHobbies.push(hobby);
        draft.hobbies.push(hobby);
        $("customHobby").value = "";
        renderHobbies();
        updateSummary();
        $("customHobby").focus();
    }
    function addCity(value = $("wishCity").value) {
        const city = value.trim();
        $("wishlistFeedback").textContent = "";
        if (!city) {
            $("wishlistFeedback").textContent = "Which city are you dreaming of?";
            return $("wishCity").focus();
        }
        if (city.length > 60) {
            $("wishlistFeedback").textContent = "Keep the city name under 60 characters.";
            return;
        }
        if (draft.wishlist.some((w) => w.city.toLocaleLowerCase() === city.toLocaleLowerCase())) {
            $("wishlistFeedback").textContent = "That city already has a spot on your list.";
            return;
        }
        if (draft.wishlist.length >= 50) {
            $("wishlistFeedback").textContent = "Keep up to 50 cities on this wishlist.";
            return;
        }
        const known = window.PlannerCatalogue.cities.find(
            (c) => c.toLocaleLowerCase() === city.toLocaleLowerCase(),
        );
        draft.wishlist.push({
            id: uniqueId(),
            city: known || city,
            priority: "someday",
            month: "",
            note: "",
            visited: false,
        });
        $("wishCity").value = "";
        renderWishlist();
        updateSummary();
        $("wishCity").focus();
    }
    function syncWishInput(input) {
        const card = input.closest("[data-wish]");
        if (!card) return;
        const wish = draft.wishlist.find((w) => w.id === card.dataset.wish);
        if (!wish) return;
        wish[input.dataset.wishField] = input.type === "checkbox" ? input.checked : input.value;
        if (input.dataset.wishField === "visited") {
            card.classList.toggle("visited", wish.visited);
            card.querySelector("[data-visited-status]").hidden = !wish.visited;
        }
    }
    async function syncSharedName(name) {
        if (!group || location.protocol === "file:") return;
        let sessions;
        try {
            sessions = JSON.parse(localStorage.getItem("planmateSessionsV1") || "{}");
        } catch {
            return;
        }
        const session = sessions?.[group];
        if (!session?.token && !window.PlanmateAccount.account()) return;
        const headers = {
            "Content-Type": "application/json",
            ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
            ...window.PlanmateAccount.headers(),
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await fetch(`/api/groups/${group}`, {
                headers,
                signal: AbortSignal.timeout(8000),
            });
            if (!result.ok)
                throw new Error(
                    "Your profile is saved here. Reconnect to update your name in the shared trip.",
                );
            const { state } = await result.json();
            if (
                state.members.find(
                    (m) =>
                        m.id ===
                        (session?.memberId ||
                            state.members.find(
                                (m) => m.accountId === window.PlanmateAccount.account()?.id,
                            )?.id),
                )?.name === name
            )
                return;
            const response = await fetch(`/api/groups/${group}/commands`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    type: "updateMember",
                    revision: state.revision,
                    payload: { name },
                }),
                signal: AbortSignal.timeout(8000),
            });
            if (response.status === 409)
                throw new Error(
                    "Your private profile is saved. The trip changed; review it before updating your shared display name.",
                );
            if (!response.ok)
                throw new Error(
                    "Your profile is saved here. Your shared trip name couldn’t be updated yet.",
                );
            return;
        }
        throw new Error(
            "Your profile is saved here. The trip changed; save again to update its display name.",
        );
    }
    async function saveProfile() {
        if (saving || !$("profileForm").reportValidity()) return false;
        if (P.identity() !== identityAtLoad) {
            $("profileError").textContent =
                "Your login changed in another tab. Reload this profile before saving.";
            $("profileError").hidden = false;
            return false;
        }
        if (!$("displayName").value.trim()) {
            $("displayName").setCustomValidity("Enter a name, not just spaces.");
            $("displayName").reportValidity();
            return false;
        }
        saving = true;
        $("saveProfile").disabled = true;
        $("discardChanges").disabled = true;
        $("profileError").hidden = true;
        try {
            saved = await P.save(collect());
            draft = clone(saved);
            updateSummary();
            let synced = true;
            try {
                await syncSharedName(saved.name);
            } catch (error) {
                synced = false;
                $("profileError").textContent = error.message.startsWith("Your profile")
                    ? error.message
                    : "Your profile is saved here. Reconnect to update your name in the shared trip.";
                $("profileError").hidden = false;
            }
            toast(
                synced
                    ? "A little more you, saved. ✧"
                    : "Your travel preferences are saved on this browser.",
            );
            return true;
        } catch (error) {
            $("profileError").textContent =
                error.message ||
                "Your profile couldn’t be saved. Allow browser storage, then try again. Your edits are still here.";
            $("profileError").hidden = false;
            if (error.status === 409) {
                let latest;
                try {
                    latest = await window.PlanmateAccount.call("/api/profile");
                } catch (e) {
                    $("profileError").textContent = e.message;
                    return false;
                }
                $("profileError").innerHTML =
                    `Your profile changed on another device. Latest: ${escape(latest.profile.name)} · ${escape(latest.profile.pace || "balanced")} pace · ${latest.profile.wishlist?.length || 0} wishlist cities. Your edits are still in the form. <button type="button" class="button secondary" id="reviewProfileConflict">Keep my edits against this version</button>`;
                $("reviewProfileConflict").onclick = () => {
                    window.PlanmateAccount.acceptProfileRevision(latest.revision);
                    $("profileError").textContent =
                        "Latest version reviewed. Save explicitly to submit your current edits.";
                };
            }
            return false;
        } finally {
            saving = false;
            $("saveProfile").disabled = false;
            updateSummary();
        }
    }
    function askDiscard(url = "") {
        pendingNavigation = url;
        $("discardTitle").textContent = url
            ? "Leave these edits behind?"
            : "Keep your last saved profile?";
        $("discardDialog").showModal();
    }
    $("profileForm").addEventListener("submit", (event) => {
        event.preventDefault();
        saveProfile();
    });
    $("profileForm").addEventListener("input", (event) => {
        if (event.target.id === "displayName") event.target.setCustomValidity("");
        if (event.target.matches("[data-wish-field]")) syncWishInput(event.target);
        updateSummary();
    });
    $("profileForm").addEventListener("change", (event) => {
        if (
            event.target.name === "hobby" &&
            document.querySelectorAll('[name="hobby"]:checked').length > 20
        ) {
            event.target.checked = false;
            $("hobbyFeedback").textContent = "Choose up to 20 hobbies.";
        }
        if (event.target.matches("[data-wish-field]")) syncWishInput(event.target);
        updateSummary();
    });
    $("addHobby").addEventListener("click", addHobby);
    $("addWish").addEventListener("click", () => addCity());
    for (const [id, action] of [
        ["customHobby", addHobby],
        ["wishCity", () => addCity()],
    ])
        $(id).addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                action();
            }
        });
    $("profileForm").addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || saving) return;
        if (button.dataset.suggestCity) addCity(button.dataset.suggestCity);
        if (button.dataset.removeWish) {
            draft.wishlist = draft.wishlist.filter((w) => w.id !== button.dataset.removeWish);
            renderWishlist();
            updateSummary();
        }
        if (button.dataset.planWish) {
            const wish = draft.wishlist.find((w) => w.id === button.dataset.planWish);
            if (!wish) return;
            if (await saveProfile()) {
                const wishlistParams = new URLSearchParams(returnParams);
                wishlistParams.set("planCity", wish.city);
                location.href = `dashboard.html?${wishlistParams}`;
            }
        }
    });
    $("discardChanges").addEventListener("click", () => askDiscard());
    $("keepEditing").addEventListener("click", () => {
        pendingNavigation = "";
        $("discardDialog").close();
    });
    $("confirmDiscard").addEventListener("click", () => {
        const url = pendingNavigation;
        pendingNavigation = "";
        draft = clone(saved);
        extraHobbies = saved.hobbies.filter((h) => !P.hobbies.includes(h));
        $("hobbyFeedback").textContent = "";
        $("wishlistFeedback").textContent = "";
        $("profileError").hidden = true;
        renderForm();
        $("discardDialog").close();
        if (url) location.href = url;
    });
    for (const id of ["backToPlan", "profileBrand"])
        $(id).addEventListener("click", (event) => {
            if (dirty) {
                event.preventDefault();
                askDiscard(event.currentTarget.getAttribute("href"));
            }
        });
    window.addEventListener("beforeunload", (event) => {
        if (dirty) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    window.addEventListener("storage", (event) => {
        if (event.key === P.KEY) {
            if (!dirty) {
                saved = P.load(fallbackName);
                draft = clone(saved);
                renderForm();
            } else
                toast(
                    "Your profile changed in another tab. Save these edits to keep this version.",
                );
        }
    });
    renderForm();
    $("profileForm").inert = false;
    $("profileForm").setAttribute("aria-busy", "false");
    const account = window.PlanmateAccount.account();
    $("accountBanner").innerHTML = account
        ? `Signed in as ${escape(account.name)} · Private profile syncs across devices. <button type="button" class="text-button" id="importLocalProfile">Copy local travel preferences into this form</button><button type="button" class="text-button" data-account-action="signout-all">Sign out on all devices</button>`
        : `Local demo profile · saved on this browser only.${window.PlanmateAccount.error() ? " " + escape(window.PlanmateAccount.error()) : ""}`;
    if (account)
        $("importLocalProfile").onclick = () => {
            draft = { ...P.localProfile(), name: saved.name };
            renderForm();
            toast(
                "Local preferences copied into the form. Review and save to your account explicitly.",
            );
        };
    // A guest may open an invitation's profile in a fresh tab without navigation context.
    // In that case use their actual membership name rather than the generic "You" default.
    if (group && !saved.updatedAt && !P.account().name && location.protocol !== "file:") {
        (async () => {
            let sessions;
            try {
                sessions = JSON.parse(localStorage.getItem("planmateSessionsV1") || "{}");
            } catch {
                return;
            }
            const session = sessions?.[group];
            if (!session?.token) return;
            const response = await fetch(`/api/groups/${group}`, {
                headers: { Authorization: `Bearer ${session.token}` },
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) return;
            const { state } = await response.json(),
                name = state.members.find((m) => m.id === session.memberId)?.name;
            if (name && !dirty && $("displayName").value === saved.name) {
                saved.name = name;
                draft.name = name;
                $("displayName").value = name;
                updateSummary();
            }
        })().catch(() => {
            /* Personal preferences remain editable while the server is offline. */
        });
    }
})();
