/* Private, bounded form drafts. Shared changes still require explicit submission. */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.PlanmateDrafts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const KEY = "planmateFormDraftsV1",
        MAX_AGE = 7 * 86400000;
    const fields = {
        journey: "from to train departureDate departureTime arrivalDate arrivalTime status note",
        preferences: "interests pace budget mustHave needs",
        availability: "options",
        "add-date": "date start end endNextDay",
        "choose-date": "endDate",
        estimate: "cost travel",
        comment: "text",
        "edit-comment": "text",
        coordinates: "latitude longitude source",
        "edit-trip": "title city start end budget",
        schedule: "date start end endNextDay travel cost costKnown note",
        "edit-stop": "date start end endNextDay travel cost costKnown note",
        propose: "preferredDate note placeLabel",
        custom: "name city category area source preferredDate note",
        expense: "description amount payer split participants",
        repayment: "from to amount note",
        caption: "caption",
        upload: "caption",
    };
    function allowed(kind, name) {
        return (
            fields[kind]?.split(" ").includes(name) ||
            (kind === "expense" && /^share-[A-Za-z0-9_-]{1,100}$/.test(name))
        );
    }
    function cleanValues(kind, value) {
        return Object.fromEntries(
            Object.entries(value || {})
                .filter(([name]) => allowed(kind, name))
                .slice(0, 80)
                .map(([name, values]) => [
                    name,
                    (Array.isArray(values) ? values : [values])
                        .filter((v) => typeof v === "string")
                        .slice(0, 40)
                        .map((v) => v.slice(0, 2000)),
                ]),
        );
    }
    function contextKey(c) {
        return JSON.stringify([c.owner, c.space, c.member]);
    }
    function formKey(c, d) {
        return JSON.stringify([contextKey(c), d.source, d.kind, d.id || "", d.proposal || ""]);
    }
    function createStore(storage, now = Date.now) {
        let memory = {},
            available = true;
        function read() {
            if (!available) return memory;
            try {
                const value = JSON.parse(storage.getItem(KEY) || "{}");
                memory = value && typeof value === "object" && !Array.isArray(value) ? value : {};
            } catch {
                available = false;
            }
            return memory;
        }
        function write(value) {
            memory = value;
            try {
                storage.setItem(KEY, JSON.stringify(value));
            } catch {
                available = false;
            }
        }
        function list(c) {
            return Object.entries(read())
                .filter(
                    ([, r]) =>
                        r &&
                        r.context === contextKey(c) &&
                        Object.hasOwn(fields, r.kind) &&
                        now() - r.at < MAX_AGE &&
                        now() >= r.at,
                )
                .map(([key, r]) => ({ ...r, key, values: cleanValues(r.kind, r.values) }));
        }
        function save(c, d, values, base) {
            const key = formKey(c, d),
                data = read();
            for (const [k, r] of Object.entries(data))
                if (!r || now() - r.at >= MAX_AGE) delete data[k];
            data[key] = {
                context: contextKey(c),
                source: d.source,
                kind: d.kind,
                id: String(d.id || "").slice(0, 100),
                proposal: String(d.proposal || "").slice(0, 100),
                values: cleanValues(d.kind, values),
                base,
                at: now(),
            };
            const keys = Object.keys(data).sort((a, b) => data[b].at - data[a].at);
            for (const k of keys.slice(60)) delete data[k];
            write(data);
            return { ...data[key], key };
        }
        function remove(key) {
            const data = read();
            delete data[key];
            write(data);
        }
        return { list, save, remove, available: () => available };
    }
    function init(a) {
        const esc = window.PlanmateUtils.escapeHtml;
        let storage;
        try {
            storage = window.localStorage;
        } catch {
            storage = {
                getItem() {
                    throw new Error("Storage unavailable");
                },
                setItem() {
                    throw new Error("Storage unavailable");
                },
            };
        }
        const store = createStore(storage),
            active = new Map(),
            primed = new WeakMap();
        let applying = false,
            savedPosition = null;
        const context = () => a.context();
        const descriptor = (form) => {
            for (const [source, attr] of [
                ["form", "form"],
                ["plan", "planForm"],
                ["outing", "outingForm"],
                ["memory", "memoryForm"],
                ["train", "trainForm"],
            ]) {
                const kind = form.dataset[attr];
                if (Object.hasOwn(fields, kind))
                    return {
                        source,
                        kind,
                        id: form.dataset.id || form.dataset.place || "",
                        proposal: form.dataset.proposal || "",
                    };
            }
            return null;
        };
        const allForms = () =>
            [...document.querySelectorAll("#workspace form, #appDialog form")].filter(descriptor);
        function values(form, d) {
            const result = {};
            for (const el of form.querySelectorAll("input,select,textarea")) {
                if (!allowed(d.kind, el.name) || ["file", "password", "hidden"].includes(el.type))
                    continue;
                result[el.name] ||= [];
                if (["checkbox", "radio"].includes(el.type)) {
                    if (el.checked) result[el.name].push(el.value);
                } else if (el.multiple)
                    result[el.name].push(...[...el.selectedOptions].map((o) => o.value));
                else result[el.name].push(el.value);
            }
            return cleanValues(d.kind, result);
        }
        function exists(d) {
            const s = a.state();
            if (!s?.members.some((m) => m.id === context().member && !m.removed)) return false;
            if (d.kind === "journey" && d.id)
                return s.journeys?.some(
                    (p) =>
                        p.id === d.id &&
                        (p.by === context().member || s.organizerId === context().member),
                );
            if (["comment", "estimate", "schedule"].includes(d.kind))
                return s.proposals.some(
                    (p) => p.id === d.id && (d.kind !== "schedule" || p.status === "pending"),
                );
            if (["edit-stop", "coordinates", "upload"].includes(d.kind))
                return s.stops.some((p) => p.id === d.id);
            if (d.kind === "edit-comment")
                return s.proposals
                    .find((p) => p.id === d.proposal)
                    ?.comments.some((c) => c.id === d.id && c.by === context().member);
            if (d.kind === "caption")
                return s.scrapbook.some((p) => p.id === d.id && p.by === context().member);
            if (d.kind === "expense" && d.id) return s.expenses.some((p) => p.id === d.id);
            if (d.kind === "choose-date") return s.availability.options.some((p) => p.id === d.id);
            return true;
        }
        function base(d) {
            if (d.kind === "journey")
                return JSON.stringify([
                    a.state().journeys,
                    a.state().stops,
                    a.state().trip.timezone,
                ]);
            const s = a.state(),
                me = context().member;
            const slots = s.stops.map((p) => ({
                id: p.id,
                date: p.date,
                start: p.start,
                end: p.end,
                endNextDay: p.endNextDay,
                cost: p.cost,
                costKnown: p.costKnown,
                travel: p.travel,
                note: p.note,
                pinned: p.pinned,
            }));
            const p = s.proposals.find((p) => p.id === (d.proposal || d.id));
            const data =
                d.kind === "preferences"
                    ? s.preferences[me] || null
                    : d.kind === "availability"
                      ? [s.availability.options, s.availability.responses[me] || null]
                      : d.kind === "edit-comment"
                        ? p?.comments.find((c) => c.id === d.id)
                        : d.kind === "comment"
                          ? Boolean(p)
                          : d.kind === "estimate"
                            ? p?.estimate
                            : d.kind === "edit-stop"
                              ? slots.find((p) => p.id === d.id)
                              : d.kind === "coordinates"
                                ? s.stops.find((p) => p.id === d.id)?.place.coordinates || null
                                : d.kind === "caption"
                                  ? s.scrapbook.find((p) => p.id === d.id)?.caption
                                  : d.kind === "expense"
                                    ? [s.expenses.find((p) => p.id === d.id) || null, s.members]
                                    : d.kind === "repayment"
                                      ? [s.expenses, s.repayments, s.members]
                                      : d.kind === "schedule"
                                        ? [p?.status, s.trip, slots]
                                        : s.trip;
            return JSON.stringify(data ?? null);
        }
        function apply(form, r) {
            applying = true;
            for (const el of form.querySelectorAll("input,select,textarea")) {
                const selected = r.values[el.name];
                if (
                    !selected ||
                    !allowed(r.kind, el.name) ||
                    ["file", "password", "hidden"].includes(el.type)
                )
                    continue;
                if (["checkbox", "radio"].includes(el.type))
                    el.checked = selected.includes(el.value);
                else if (el.multiple)
                    [...el.options].forEach((o) => {
                        o.selected = selected.includes(o.value);
                    });
                else if (
                    el.tagName !== "SELECT" ||
                    [...el.options].some((o) => o.value === selected[0])
                )
                    el.value = selected[0] || "";
            }
            form.querySelector('[name="split"]')?.dispatchEvent(
                new Event("change", { bubbles: true }),
            );
            applying = false;
        }
        function note(form, r) {
            form.querySelector(".form-draft-note")?.remove();
            const el = document.createElement("div");
            el.className = "form-draft-note plan-notice";
            const current = base(r),
                conflict = r.review || current !== r.base;
            const s = a.state(),
                pref = s.preferences[context().member];
            const latest =
                r.kind === "preferences"
                    ? pref
                        ? `${pref.interests.join(", ") || "No interests"}; ${pref.pace} pace; ${pref.budgetPaise === null ? "no budget limit" : "₹" + (pref.budgetPaise / 100).toFixed(2) + " limit"}; must-have: ${pref.mustHave || "none"}`
                        : "No trip preferences are shared yet."
                    : r.kind === "edit-comment"
                      ? s.proposals
                            .find((p) => p.id === r.proposal)
                            ?.comments.find((c) => c.id === r.id)?.text ||
                        "This comment is unavailable."
                      : r.kind === "availability"
                        ? "The available date options or your shared response changed. Compare the windows in this poll with your unfinished selection."
                        : "The plan changed after you started editing. Check the latest itinerary and discussion before keeping your unfinished values.";
            el.innerHTML = `${conflict ? "Shared details changed. Your unfinished values are preserved; review before saving." : "Unfinished changes are private to this browser."}${!store.available() ? " Storage is unavailable: keep this tab open." : ""}
                ${conflict ? `<details><summary>Latest shared information</summary><p>${esc(latest)}</p></details><button type="button" class="text-button" data-draft-action="review" data-key="${esc(r.key)}">I reviewed the changes — keep my draft</button>` : ""}
                <button type="button" class="text-button" data-draft-action="discard" data-key="${esc(r.key)}">Discard unfinished changes</button>`;
            form.prepend(el);
        }
        function banner() {
            const mount = document.getElementById("draftRecovery");
            if (!mount) return;
            const visible = allForms()
                .filter((f) => !f.closest("dialog") || f.closest("dialog").open)
                .map((f) => formKey(context(), descriptor(f)));
            const rows = store
                .list(context())
                .filter((r) => !active.has(r.key) || !visible.includes(r.key) || !exists(r));
            mount.hidden = !rows.length;
            mount.innerHTML = rows.length
                ? `<strong>Unfinished work on this browser</strong><p>Review and restore a private draft, or discard it.</p>${rows.map((r) => `<div class="plan-row"><span>${esc(r.kind.replaceAll("-", " "))}${!exists(r) ? " · original item or membership is unavailable" : ""}</span>${exists(r) ? `<button type="button" class="button secondary small" data-draft-action="restore" data-key="${esc(r.key)}">Restore</button>` : ""}<button type="button" class="text-button" data-draft-action="discard" data-key="${esc(r.key)}">Discard</button></div>`).join("")}`
                : "";
        }
        function afterRender() {
            for (const form of allForms()) {
                const d = descriptor(form),
                    key = formKey(context(), d);
                if (!primed.has(form)) primed.set(form, { values: values(form, d), base: base(d) });
                const r = active.get(key);
                if (r && exists(r)) {
                    apply(form, r);
                    note(form, r);
                }
            }
            banner();
            if (
                savedPosition &&
                savedPosition.context === contextKey(context()) &&
                savedPosition.view === a.view()
            ) {
                for (const [id, open] of savedPosition.details) {
                    const card = [...document.querySelectorAll("[data-proposal-id]")].find(
                        (p) => p.dataset.proposalId === id,
                    );
                    if (open)
                        card?.querySelector(".suggestion-discussion")?.setAttribute("open", "");
                }
                const target = allForms().find(
                    (f) => formKey(context(), descriptor(f)) === savedPosition.form,
                );
                const input =
                    target &&
                    [...target.elements].find(
                        (e) => e.name === savedPosition.name && e.type !== "hidden",
                    );
                if (input) {
                    input.focus({ preventScroll: true });
                    if (savedPosition.start != null && input.setSelectionRange)
                        try {
                            input.setSelectionRange(savedPosition.start, savedPosition.end);
                        } catch {
                            /* numeric inputs have no selection */
                        }
                }
                window.scrollTo(savedPosition.x, savedPosition.y);
            }
            savedPosition = null;
        }
        function beforeRender() {
            const input = document.activeElement,
                form = input?.closest?.("form"),
                d = form && descriptor(form);
            savedPosition = {
                context: contextKey(context()),
                view: a.view(),
                form: d && formKey(context(), d),
                name: input?.name,
                start: input?.selectionStart,
                end: input?.selectionEnd,
                x: window.scrollX,
                y: window.scrollY,
                details: [...document.querySelectorAll("[data-proposal-id]")].map((p) => [
                    p.dataset.proposalId,
                    Boolean(p.querySelector(".suggestion-discussion")?.open),
                ]),
            };
        }
        function capture(event) {
            if (applying) return;
            const form = event.target.closest?.("form"),
                d = form && descriptor(form);
            if (!d) return;
            const previous = primed.get(form) || { values: {}, base: base(d) },
                current = values(form, d),
                key = formKey(context(), d);
            if (JSON.stringify(current) === JSON.stringify(previous.values)) {
                store.remove(key);
                active.delete(key);
                form.querySelector(".form-draft-note")?.remove();
            } else {
                const old = active.get(key),
                    r = store.save(context(), d, current, old?.base || previous.base);
                if (old?.review) r.review = true;
                active.set(key, r);
                note(form, r);
            }
            banner();
        }
        document.addEventListener("input", capture);
        document.addEventListener("change", capture);
        document.addEventListener(
            "submit",
            (e) => {
                const d = descriptor(e.target);
                if (!d) return;
                const r = active.get(formKey(context(), d));
                if (r && (r.review || r.base !== base(r))) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    note(e.target, r);
                    a.toast(
                        "Review the changed shared details before saving your unfinished work.",
                    );
                }
            },
            true,
        );
        document.addEventListener("planmate:form-saved", (e) => {
            const d = descriptor(e.detail.form);
            if (!d) return;
            const key = formKey(context(), d);
            store.remove(key);
            active.delete(key);
            a.render();
        });
        document.addEventListener("click", (e) => {
            const b = e.target.closest("[data-draft-action]");
            if (!b) return;
            const r = store.list(context()).find((r) => r.key === b.dataset.key);
            if (!r) return;
            if (b.dataset.draftAction === "discard") {
                store.remove(r.key);
                active.delete(r.key);
                const form = b.closest("form");
                if (form) {
                    form.reset();
                    primed.delete(form);
                    form.querySelector(".form-draft-note")?.remove();
                }
                a.render();
            } else if (b.dataset.draftAction === "review") {
                const kept = active.get(r.key);
                kept.base = base(r);
                kept.review = false;
                store.save(context(), kept, kept.values, kept.base);
                afterRender();
            } else if (exists(r)) {
                active.set(r.key, r);
                a.open(r);
                afterRender();
            }
        });
        const dialog = document.getElementById("appDialog");
        if (dialog)
            new MutationObserver(() => {
                // Ignore changes to our own notices; only prime newly inserted forms.
                if (allForms().some((f) => !primed.has(f))) afterRender();
            }).observe(dialog, { childList: true, subtree: true });
        window.addEventListener("beforeunload", (e) => {
            if (
                !store.available() &&
                [...active.values()].some((r) => r.context === contextKey(context()))
            ) {
                e.preventDefault();
                e.returnValue = "";
            }
        });
        return {
            beforeRender,
            afterRender,
            conflict: () => {
                for (const r of active.values())
                    if (r.context === contextKey(context())) r.review = true;
                afterRender();
            },
        };
    }
    return { KEY, contextKey, formKey, cleanValues, createStore, init };
});
