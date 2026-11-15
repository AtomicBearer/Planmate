/* Map, timing previews, suggestion discussion and an outing-sized mobile view. */
(function () {
    "use strict";
    function init(a, u) {
        const C = window.PlannerCore,
            O = C.agreement.outing,
            esc = window.PlanmateUtils.escapeHtml,
            { button, field, panel, notice, run } = u;
        let day = "",
            todayDay = "",
            selected = "",
            group = "",
            mapInfo = null,
            mapSignature = "",
            mapImage = "",
            mapBusy = false,
            mapRequestId = 0,
            mapError = "",
            preview = null,
            dragId = "",
            routeResults = {},
            routeSignature = "";
        const s = () => a.state(),
            host = () => s().organizerId === a.memberId();
        const signature = () =>
            JSON.stringify([s().materialVersion, s().proposals.map((p) => [p.id, p.status])]);
        const routesSignature = () =>
            JSON.stringify(
                C.orderedStops(s()).map((p) => [
                    p.id,
                    p.place.id,
                    p.place.coordinates,
                    p.date,
                    p.start,
                    p.travel,
                ]),
            );
        function clearMap() {
            mapRequestId++;
            mapBusy = false;
            mapError = "";
            mapInfo = null;
            if (mapImage) URL.revokeObjectURL(mapImage);
            mapImage = "";
        }
        function dated(value) {
            return new Date(value).toLocaleString("en-IN", { timeZone: s().trip.timezone });
        }
        function comments(p) {
            return `<details class="suggestion-discussion"><summary>Discussion · ${p.comments.length}</summary>${p.comments.length ? p.comments.map((c) => `<article class="comment"><strong>${esc(a.memberName(c.by))}</strong><small>${esc(dated(c.createdAt))}${c.updatedAt ? " · edited " + esc(dated(c.updatedAt)) : ""}</small><p>${esc(c.text)}</p>${c.by === a.memberId() ? `<div class="plan-row">${button("edit-comment", "Edit", c.id, `data-proposal="${esc(p.id)}"`)}${button("delete-comment", "Delete", c.id, `data-proposal="${esc(p.id)}"`)}</div>` : ""}</article>`).join("") : notice("No comments yet. Keep this place's discussion together here.")}<form data-outing-form="comment" data-id="${esc(p.id)}">${field("Add a comment", '<textarea name="text" maxlength="1000" rows="2" required placeholder="Meeting points, questions, ideas…"></textarea>')}<button class="button secondary small" type="submit">Post comment</button></form></details>`;
        }
        function reset() {
            const key = a.groupCode() || JSON.stringify([s().trip.title, s().members[0].id]);
            if (group !== key) {
                group = key;
                day = "";
                const initialTodayDay = a.initialTodayDay?.() || "";
                todayDay = C.dates(s().trip.start, s().trip.end).includes(initialTodayDay)
                    ? initialTodayDay
                    : "";
                clearMap();
                selected = "";
                routeResults = {};
            }
            const requestedDay = a.selectedDay?.();
            if (
                requestedDay &&
                requestedDay !== day &&
                C.dates(s().trip.start, s().trip.end).includes(requestedDay)
            ) {
                day = requestedDay;
                selected = "";
                clearMap();
            }
            if (mapInfo && mapSignature !== signature()) clearMap();
            const currentRoutes = routesSignature();
            if (routeSignature !== currentRoutes) {
                routeSignature = currentRoutes;
                routeResults = {};
            }
        }
        function points() {
            if (mapInfo) return mapInfo.points;
            const entries = [
                ...C.orderedStops(s())
                    .filter((p) => p.date === day)
                    .map((p) => ({ id: p.id, place: p.place, stop: true })),
                ...s()
                    .proposals.filter((p) => p.status === "pending")
                    .map((p) => ({ id: p.id, place: p.place, stop: false })),
            ].filter((p) => p.place.provider !== "google" && p.place.coordinates);
            const raw = entries.map((p) => ({ ...p, ...p.place.coordinates }));
            if (!raw.length) return [];
            const minLat = Math.min(...raw.map((p) => p.latitude)),
                maxLat = Math.max(...raw.map((p) => p.latitude)),
                minLon = Math.min(...raw.map((p) => p.longitude)),
                maxLon = Math.max(...raw.map((p) => p.longitude));
            return raw.map((p, i) => ({
                ...p,
                x: 70 + (500 * (p.longitude - minLon)) / Math.max(maxLon - minLon, 0.00001),
                y: 330 - (260 * (p.latitude - minLat)) / Math.max(maxLat - minLat, 0.00001),
                label: String(i + 1),
            }));
        }
        function mapPanel() {
            const ps = points(),
                scheduled = C.orderedStops(s()).filter((p) => p.date === day),
                missing = scheduled.filter((p) => !ps.some((x) => x.id === p.id)),
                path = scheduled.map((p) => ps.find((x) => x.id === p.id)).filter(Boolean),
                chosen = ps.find((p) => p.id === selected),
                undo = s().reorderUndo,
                canUndo =
                    undo &&
                    (undo.by === a.memberId() || host()) &&
                    JSON.stringify(s().stops) === JSON.stringify(undo.after);
            return panel(
                "Our day, on the map",
                `<div class="plan-row">${field(
                    "Map day",
                    `<select id="mapDay">${C.dates(s().trip.start, s().trip.end)
                        .map((d) => `<option ${d === day ? "selected" : ""}>${d}</option>`)
                        .join("")}</select>`,
                )}${a.groupCode() ? button("refresh-map", mapBusy ? "Loading locations…" : "Refresh locations & map", "", mapBusy ? "disabled" : "") : ""}${canUndo ? button("undo-reorder", "Undo last reorder") : ""}</div>${mapError ? `<p class="plan-error" role="alert">${esc(mapError)}</p>` : ""}${ps.length ? `<div class="linked-map" aria-label="Place location map">${mapImage ? `<img src="${esc(mapImage)}" alt="Google map of this day's locations">` : `<svg viewBox="0 0 640 400" aria-hidden="true"><rect width="640" height="400" fill="#edeadd"/>${[100, 200, 300].map((y) => `<path d="M0 ${y}H640" stroke="#d4d0c0"/>`).join("")}${[160, 320, 480].map((x) => `<path d="M${x} 0V400" stroke="#d4d0c0"/>`).join("")}<text x="16" y="24" fill="#655744" font-size="13">N ↑ · Group-supplied locations</text></svg>`}<svg class="order-line" viewBox="0 0 640 400" aria-hidden="true"><polyline points="${path.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#8e6f52" stroke-width="2" stroke-dasharray="5 5"/></svg>${ps.map((p) => `<button class="map-marker ${p.id === selected ? "selected" : ""}" style="left:${(p.x / 640) * 100}%;top:${(p.y / 400) * 100}%" data-plan-action="map-select" data-id="${esc(p.id)}" aria-label="Locate ${esc(a.displayPlace(s().stops.find((x) => x.id === p.id)?.place || s().proposals.find((x) => x.id === p.id)?.place || p.place).name)}" aria-pressed="${p.id === selected}">${esc(p.label)}</button>`).join("")}</div>` : notice(scheduled.length ? "Locations are unavailable for these stops. Directions links still work; you can add a sourced location or refresh shared locations." : "Add a stop to your itinerary to see its location here.")}${ps.length ? notice("Dashed lines show visit order. Use directions for roads and travel distances.") : ""}${ps.length ? notice(mapInfo?.imageToken ? "Google Maps · Current place locations" : "Location overview · Sourced by your group") : ""}${chosen ? notice(`Selected: ${a.displayPlace(s().stops.find((x) => x.id === selected)?.place || s().proposals.find((x) => x.id === selected)?.place || chosen.place).name} · ${chosen.latitude.toFixed(5)}, ${chosen.longitude.toFixed(5)}`) : ""}${missing.length ? notice(`Locations unavailable: ${missing.map((p) => a.displayPlace(p.place).name).join(", ")}`) : ""}${mapInfo?.missing?.map((p) => notice(`${a.displayPlace(s().stops.find((x) => x.id === p.id)?.place || s().proposals.find((x) => x.id === p.id)?.place).name}: ${p.reason}`)).join("") || ""}`,
            );
        }
        function controls(stop) {
            const list = C.orderedStops(s()).filter((p) => p.date === stop.date),
                index = list.findIndex((p) => p.id === stop.id),
                v = s().visits[stop.id];
            const routeControl =
                index > 0
                    ? a.routesAvailable?.()
                        ? button("route", "Check connected route", stop.id)
                        : notice(
                              "Route checking is off. Enter and review a manual travel buffer between stops.",
                          )
                    : "";
            return `<div class="plan-row stop-tools">${button("locate", "Locate on map", stop.id)}${button("move-up", "Move up", stop.id, index === 0 ? "disabled" : "")}${button("move-down", "Move down", stop.id, index === list.length - 1 ? "disabled" : "")}<button class="button secondary small drag-handle" type="button" draggable="true" data-drag-id="${esc(stop.id)}" aria-label="Drag ${esc(a.displayPlace(stop.place).name)} to reorder. Move up and down controls are also available.">↕ Drag</button>${button("visit", v ? "Visited ✓ · undo" : "Mark group visited", stop.id)}${stop.place.provider !== "google" ? button("coordinates", "Set sourced location", stop.id) : ""}</div>${notice(`${O.fixed(stop) ? "Pinned / fixed time · " : ""}${v ? "Group visited by " + a.memberName(v.by) + " · " : ""}${stop.costKnown ? "Cost is a group estimate" : "Cost unknown — displayed total is incomplete"} · ${stop.travelKnown ? "Travel buffer is a manual estimate" : "Travel unknown — zero minutes reserved; review before confirming"}`)}${routeControl}<p class="plan-notice" data-route-result="${esc(stop.id)}">${esc(routeResults[stop.id] || "")}</p>`;
        }
        function today() {
            const info = O.today(s(), new Date(), todayDay || undefined),
                limit =
                    s().preferences[a.memberId()]?.budgetPaise ?? Math.round(s().trip.budget * 100),
                past = info.date < info.current.date;
            return panel(
                "Today's little adventure",
                notice(
                    `${info.date} · ${s().trip.timezone}${past ? " · Past day" : info.date > info.current.date ? " · Future day" : ""}`,
                ) +
                    `${field(
                        "View a trip day",
                        `<select id="todayDay"><option value="">Today (${info.current.date})</option>${C.dates(
                            s().trip.start,
                            s().trip.end,
                        )
                            .map(
                                (d) =>
                                    `<option value="${d}" ${todayDay === d ? "selected" : ""}>${d}</option>`,
                            )
                            .join("")}</select>`,
                    )}` +
                    notice(
                        info.next
                            ? `Next scheduled stop: ${a.displayPlace(info.next.place).name} · ${info.next.start}`
                            : past
                              ? "This is a past day. Review the visit record and memories."
                              : "No next scheduled stop for this day.",
                    ) +
                    notice(
                        `Remaining estimated budget / person: ${a.money((limit - info.spentKnown) / 100)} after group-visited stops. This uses estimates, not actual expenses.${info.unknownVisited ? " Visited stops have unknown costs; this amount is incomplete." : ""}`,
                    ) +
                    (info.activities.length
                        ? info.activities
                              .map(
                                  (p) =>
                                      `<article class="today-card ${p.id === info.next?.id ? "next-stop" : ""}"><span>${p.start}–${p.end}${p.endNextDay ? " (+1 day)" : ""}${p.date !== info.date ? " · continued from yesterday" : ""}</span><h3>${esc(a.displayPlace(p.place).name)}</h3>${p.note ? notice(p.note) : ""}<div class="plan-row"><a class="button secondary small" href="${esc(a.mapsUrl(p.place))}" target="_blank" rel="noopener noreferrer">Directions ↗</a>${button("visit", s().visits[p.id] ? "Visited ✓ · undo" : "Mark group visited", p.id)}</div>${notice(s().visits[p.id] ? `Visited by the group · marked by ${a.memberName(s().visits[p.id].by)}` : "Group visit progress is separate from individual attendance.")}</article>`,
                              )
                              .join("")
                        : notice(
                              "No activities on this day. Your itinerary remains available for other trip dates.",
                          )),
            );
        }
        function render(view) {
            reset();
            const days = C.dates(s().trip.start, s().trip.end);
            if (!days.includes(day)) day = s().trip.start;
            if (todayDay && !days.includes(todayDay)) todayDay = "";
            if (view === "today") document.getElementById("workspace").innerHTML = today();
            if (view === "ideas")
                document.querySelectorAll(".idea-card").forEach((card) => {
                    const p = s().proposals.find((p) => p.id === card.dataset.proposalId);
                    if (p) card.insertAdjacentHTML("beforeend", comments(p));
                });
            if (view === "itinerary") {
                document.getElementById("workspace").insertAdjacentHTML("afterbegin", mapPanel());
                document.querySelectorAll(".stop-card").forEach((card) => {
                    const id = card.querySelector('[data-action="edit-stop"]')?.dataset.id,
                        p = s().stops.find((p) => p.id === id);
                    if (!p) return;
                    card.dataset.stopId = id;
                    card.dataset.stopDay = p.date;
                    card.tabIndex = -1;
                    card.classList.toggle("selected-stop", selected === id);
                    card.querySelector(".stop-content").insertAdjacentHTML(
                        "beforeend",
                        controls(p),
                    );
                });
            }
        }
        function redrawMap() {
            const target = [...document.querySelectorAll("#workspace .plan-panel")].find(
                (p) => p.querySelector("h2")?.textContent === "Our day, on the map",
            );
            if (target) {
                const temp = document.createElement("div");
                temp.innerHTML = mapPanel();
                target.replaceWith(temp.firstElementChild);
            }
        }
        function choose(id) {
            selected = id;
            document
                .querySelectorAll(".stop-card")
                .forEach((c) => c.classList.toggle("selected-stop", c.dataset.stopId === id));
            redrawMap();
            const card = [...document.querySelectorAll(".stop-card")].find(
                (c) => c.dataset.stopId === id,
            );
            if (card) {
                card.focus({ preventScroll: true });
                card.scrollIntoView({
                    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                        ? "instant"
                        : "smooth",
                    block: "nearest",
                });
            }
        }
        async function refreshMap() {
            if (mapBusy) return;
            const requestId = ++mapRequestId;
            mapBusy = true;
            mapError = "";
            redrawMap();
            const key = group,
                which = day,
                sourceSignature = signature(),
                currentRequest = () =>
                    requestId === mapRequestId &&
                    key === group &&
                    which === day &&
                    sourceSignature === signature();
            try {
                const info = await a.request(`/api/groups/${a.groupCode()}/map?day=${which}`);
                if (!currentRequest()) return;
                const blob = info.imageToken
                    ? await a.blobRequest(
                          `/api/groups/${a.groupCode()}/map-image?token=${encodeURIComponent(info.imageToken)}`,
                      )
                    : null;
                if (!currentRequest()) return;
                mapInfo = info;
                mapSignature = sourceSignature;
                if (mapImage) URL.revokeObjectURL(mapImage);
                mapImage = blob ? URL.createObjectURL(blob) : "";
            } catch (e) {
                if (!currentRequest()) return;
                mapError = e.message;
                mapInfo = null;
                if (mapImage) URL.revokeObjectURL(mapImage);
                mapImage = "";
            } finally {
                if (requestId === mapRequestId) {
                    mapBusy = false;
                    redrawMap();
                }
            }
        }
        function reorder(id, direction, target) {
            const stop = s().stops.find((p) => p.id === id),
                list = C.orderedStops(s())
                    .filter((p) => p.date === stop.date)
                    .map((p) => p.id),
                index = list.indexOf(id);
            const next = target ? list.indexOf(target) : index + direction;
            if (next < 0 || next >= list.length || next === index) return;
            list.splice(index, 1);
            list.splice(next, 0, id);
            preview = O.preview(s(), stop.date, list, C);
            preview.sourceStops = JSON.stringify(s().stops);
            a.openDialog(
                "Preview a new order",
                "Review timing and conflicts. Fixed events and pinned stops keep their times.",
                `<form data-outing-form="reorder">${preview.stops
                    .map((p) => {
                        const old = s().stops.find((x) => x.id === p.id);
                        return notice(
                            `${a.displayPlace(p.place).name}: ${old.start}–${old.end} → ${p.start}–${p.end}${p.endNextDay ? " (+1 day)" : ""} · ${p.travel} min manual travel buffer`,
                        );
                    })
                    .join(
                        "",
                    )}${preview.conflicts.map((x) => `<p class="constraint-warning">${esc(x)}</p>`).join("")}<div class="plan-error" role="alert"></div><button class="button primary" type="submit" ${preview.conflicts.length ? "disabled" : ""}>Apply this order</button></form>`,
            );
        }
        document.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-plan-action]");
            if (!b || b.disabled) return;
            const id = b.dataset.id;
            try {
                switch (b.dataset.planAction) {
                    case "map-select":
                    case "locate": {
                        const stop = s().stops.find((p) => p.id === id);
                        if (stop && day !== stop.date) {
                            day = stop.date;
                            clearMap();
                            selected = id;
                            a.setSelectedDay?.(day);
                        }
                        choose(id);
                        break;
                    }
                    case "refresh-map":
                        await refreshMap();
                        break;
                    case "move-up":
                        reorder(id, -1);
                        break;
                    case "move-down":
                        reorder(id, 1);
                        break;
                    case "undo-reorder":
                        await run("undoReorder", {}, "Reorder undone.");
                        break;
                    case "visit":
                        await run(
                            "markVisited",
                            { id, visited: !s().visits[id] },
                            "Group visit progress updated.",
                        );
                        break;
                    case "route": {
                        if (!a.groupCode())
                            throw new Error(
                                "Connected routes need a shared server plan. Travel buffers remain manual estimates.",
                            );
                        const list = C.orderedStops(s()).filter(
                                (p) => p.date === s().stops.find((p) => p.id === id).date,
                            ),
                            index = list.findIndex((p) => p.id === id);
                        const code = a.groupCode(),
                            sourceRoutes = routesSignature();
                        b.disabled = true;
                        b.textContent = "Checking route…";
                        try {
                            const r = await a.request(`/api/groups/${a.groupCode()}/route`, {
                                method: "POST",
                                body: JSON.stringify({ fromId: list[index - 1].id, toId: id }),
                            });
                            if (code !== a.groupCode() || sourceRoutes !== routesSignature())
                                return;
                            routeResults[id] =
                                `${r.provider}: ${Math.ceil(r.durationSeconds / 60)} min · ${(r.distanceMeters / 1000).toFixed(1)} km, checked ${dated(r.checkedAt)}. Source: ${r.sourceUrl}. Manual buffer remains ${list[index].travel} min${Math.ceil(r.durationSeconds / 60) > list[index].travel ? " — shorter than this provider estimate" : ""}.`;
                        } catch (error) {
                            if (code === a.groupCode() && sourceRoutes === routesSignature())
                                routeResults[id] = error.message;
                        } finally {
                            b.disabled = false;
                            b.textContent = "Check connected route";
                            const p = [...document.querySelectorAll("[data-route-result]")].find(
                                (x) => x.dataset.routeResult === id,
                            );
                            if (p) p.textContent = routeResults[id] || "";
                        }
                        break;
                    }
                    case "coordinates": {
                        const p = s().stops.find((p) => p.id === id),
                            c = p.place.coordinates;
                        a.openDialog(
                            "A sourced place location",
                            "Use actual coordinates with a source link. Planmate never guesses a venue location.",
                            `<form data-outing-form="coordinates" data-id="${esc(id)}">${field("Latitude", `<input name="latitude" type="number" step="any" min="-90" max="90" value="${c?.latitude ?? ""}" required>`)}${field("Longitude", `<input name="longitude" type="number" step="any" min="-180" max="180" value="${c?.longitude ?? ""}" required>`)}${field("Location source link", `<input name="source" type="url" value="${esc(c?.source || "")}" required>`)}<div class="plan-error" role="alert"></div><button class="button primary" type="submit">Save location</button></form>`,
                        );
                        break;
                    }
                    case "edit-comment": {
                        const p = s().proposals.find((p) => p.id === b.dataset.proposal),
                            c = p.comments.find((c) => c.id === id);
                        a.openDialog(
                            "Edit your comment",
                            "Changes stay attached to this suggestion.",
                            `<form data-outing-form="edit-comment" data-id="${esc(id)}" data-proposal="${esc(p.id)}">${field("Comment", `<textarea name="text" maxlength="1000" required>${esc(c.text)}</textarea>`)}<div class="plan-error" role="alert"></div><button class="button primary" type="submit">Save comment</button></form>`,
                        );
                        break;
                    }
                    case "delete-comment":
                        await run("deleteComment", { proposalId: b.dataset.proposal, id });
                        break;
                }
            } catch (error) {
                a.toast(error.message);
            }
        });
        document.addEventListener("change", (e) => {
            if (e.target.id === "mapDay") {
                day = e.target.value;
                clearMap();
                selected = "";
                if (a.setSelectedDay) a.setSelectedDay(day);
                else redrawMap();
            }
            if (e.target.id === "todayDay") {
                todayDay = e.target.value;
                if (todayDay) a.setSelectedDay?.(todayDay);
                a.setView("today");
            }
        });
        document.addEventListener("submit", async (e) => {
            const f = e.target;
            if (!f.dataset.outingForm) return;
            e.preventDefault();
            const d = Object.fromEntries(new FormData(f)),
                submit = f.querySelector('[type="submit"]');
            submit.disabled = true;
            try {
                switch (f.dataset.outingForm) {
                    case "comment":
                        await run(
                            "addComment",
                            {
                                id: window.PlanmateUtils.uniqueId(),
                                proposalId: f.dataset.id,
                                text: d.text,
                            },
                            "Comment posted.",
                        );
                        break;
                    case "edit-comment":
                        await run("editComment", {
                            id: f.dataset.id,
                            proposalId: f.dataset.proposal,
                            text: d.text,
                        });
                        a.closeDialog();
                        break;
                    case "coordinates":
                        await run("setCoordinates", {
                            id: f.dataset.id,
                            coordinates: {
                                latitude: Number(d.latitude),
                                longitude: Number(d.longitude),
                                source: d.source,
                            },
                        });
                        mapInfo = null;
                        a.closeDialog();
                        a.setView("itinerary");
                        break;
                    case "reorder":
                        await run(
                            "reorderStops",
                            {
                                date: preview.day,
                                ids: preview.ids,
                                sourceStops: preview.sourceStops,
                            },
                            "Order saved. Undo is available above the map.",
                        );
                        a.closeDialog();
                        break;
                }
                document.dispatchEvent(
                    new CustomEvent("planmate:form-saved", { detail: { form: f } }),
                );
            } catch (error) {
                const box = f.querySelector(".plan-error");
                if (box) box.textContent = error.message;
                else a.toast(error.message);
            } finally {
                submit.disabled = false;
            }
        });
        document.addEventListener("dragstart", (e) => {
            const h = e.target.closest("[data-drag-id]");
            if (h) {
                dragId = h.dataset.dragId;
                e.dataTransfer.setData("text/plain", dragId);
            }
        });
        document.addEventListener("dragover", (e) => {
            if (dragId && e.target.closest("[data-stop-id]")) e.preventDefault();
        });
        document.addEventListener("drop", (e) => {
            const card = e.target.closest("[data-stop-id]");
            if (dragId && card) {
                e.preventDefault();
                try {
                    reorder(dragId, 0, card.dataset.stopId);
                } catch (error) {
                    a.toast(error.message);
                }
                dragId = "";
            }
        });
        document.addEventListener("dragend", () => (dragId = ""));
        let touch = null;
        document.addEventListener("pointerdown", (e) => {
            const h = e.target.closest("[data-drag-id]");
            if (h && e.pointerType !== "mouse") {
                touch = { id: h.dataset.dragId, start: e.clientY };
                h.setPointerCapture(e.pointerId);
            }
        });
        document.addEventListener("pointerup", (e) => {
            if (!touch) return;
            const t = touch;
            touch = null;
            if (Math.abs(e.clientY - t.start) < 12) return;
            const target = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest("[data-stop-id]");
            if (target)
                try {
                    reorder(t.id, 0, target.dataset.stopId);
                } catch (error) {
                    a.toast(error.message);
                }
        });
        document.addEventListener("pointercancel", () => (touch = null));
        return { render, todayDay: () => todayDay };
    }
    window.OutingUI = { init };
})();
