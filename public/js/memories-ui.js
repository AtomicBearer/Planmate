(function () {
    "use strict";
    function init(a, u) {
        const C = window.PlannerCore,
            M = C.agreement.money,
            esc = window.PlanmateUtils.escapeHtml,
            uid = window.PlanmateUtils.uniqueId,
            { button, field, panel, notice, run } = u;
        const s = () => a.state(),
            owned = (p) => p.by === a.memberId() || s().organizerId === a.memberId();
        const rupees = (paise) =>
            new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(paise / 100);
        let group = "",
            images = new Map(),
            loading = new Set();
        const memberOptions = (value) =>
            s()
                .members.map(
                    (m) =>
                        `<option value="${esc(m.id)}" ${m.id === value ? "selected" : ""}>${esc(m.name)}</option>`,
                )
                .join("");
        function moneyPanel() {
            const b = M.balances(s());
            return panel(
                "A fair little ledger",
                notice(
                    "Actual expenses are separate from itinerary estimates. Amounts use INR and integer paise. These records do not send money.",
                ) +
                    `<div class="plan-row"><strong>Total actual spending: ${rupees(b.totalPaise)}</strong>${button("add-expense", "Add actual expense")}${button("add-repayment", "Record a repayment")}</div><div class="balance-grid">${s()
                        .members.map(
                            (m) =>
                                `<div><strong>${esc(m.name)}</strong><p>${b.balance[m.id] > 0 ? "Is owed " + rupees(b.balance[m.id]) : b.balance[m.id] < 0 ? "Owes " + rupees(-b.balance[m.id]) : "Settled"}</p></div>`,
                        )
                        .join(
                            "",
                        )}</div><h3>Suggested repayments</h3>${b.suggested.length ? b.suggested.map((r) => `<div class="plan-row"><span>${esc(a.memberName(r.from))} → ${esc(a.memberName(r.to))}: ${rupees(r.amountPaise)}</span>${button("suggested-repayment", "Record when paid", r.from, `data-to="${esc(r.to)}" data-amount="${r.amountPaise}"`)}</div>`).join("") : notice("Everyone is settled so far.")}<h3>Actual expenses</h3>${
                        s().expenses.length
                            ? s()
                                  .expenses.map(
                                      (e) =>
                                          `<article class="ledger-record"><div class="plan-row"><strong>${esc(e.description)}</strong><strong>${rupees(e.amountPaise)}</strong></div>${notice(`Paid by ${a.memberName(e.payer)} · recorded by ${a.memberName(e.by)} · ${e.split} split`)}${notice(
                                              Object.entries(e.shares)
                                                  .map(
                                                      ([id, p]) =>
                                                          `${a.memberName(id)}: ${rupees(p)}`,
                                                  )
                                                  .join(" · "),
                                          )}${owned(e) ? `<div class="plan-row">${button("edit-expense", "Edit expense", e.id)}${button("delete-expense", "Delete expense", e.id)}</div>` : ""}</article>`,
                                  )
                                  .join("")
                            : notice(
                                  "No actual expenses yet. Enter what was actually paid when you're ready.",
                              )
                    }<h3>Repayment records</h3>${
                        s().repayments.length
                            ? s()
                                  .repayments.map(
                                      (r) =>
                                          `<article class="ledger-record">${notice(`${a.memberName(r.from)} → ${a.memberName(r.to)}: ${rupees(r.amountPaise)} · ${r.note || "Recorded payment"} · ${new Date(r.createdAt).toLocaleString("en-IN", { timeZone: s().trip.timezone })}`)}${owned(r) ? button("delete-repayment", "Remove mistaken record", r.id) : ""}</article>`,
                                  )
                                  .join("")
                            : notice(
                                  "No repayments recorded. Add them after payment, separately from the expense.",
                              )
                    }`,
            );
        }
        function expenseForm(id) {
            const e = s().expenses.find((e) => e.id === id);
            a.openDialog(
                e ? "Edit actual expense" : "What did you pay?",
                "Use the actual paid amount. It won't change itinerary estimates.",
                `<form data-memory-form="expense" data-id="${esc(id || "")}">${field("Description", `<input name="description" maxlength="200" value="${esc(e?.description || "")}" required>`)}${field("Total amount (₹)", `<input name="amount" type="number" min="0.01" max="1000000" step="0.01" value="${e ? e.amountPaise / 100 : ""}" required>`)}${field("Paid by", `<select name="payer">${memberOptions(e?.payer || a.memberId())}</select>`)}${field("Split", `<select name="split"><option value="equal" ${e?.split !== "custom" ? "selected" : ""}>Equally</option><option value="custom" ${e?.split === "custom" ? "selected" : ""}>Custom amounts</option></select>`)}<fieldset class="plan-choice expense-participants"><legend>Participating members (custom shares in ₹)</legend>${s()
                    .members.map(
                        (m) =>
                            `<div><label><input name="participants" type="checkbox" value="${esc(m.id)}" ${!e || Object.hasOwn(e.shares, m.id) ? "checked" : ""}>${esc(m.name)}</label><input class="share-input" name="share-${esc(m.id)}" type="number" step="0.01" min="0" max="1000000" value="${e?.shares[m.id] != null ? e.shares[m.id] / 100 : ""}" aria-label="Custom share for ${esc(m.name)}" placeholder="Custom share"></div>`,
                    )
                    .join(
                        "",
                    )}</fieldset>${notice("Equal splits distribute leftover paise in group member order. Custom shares must total the expense exactly; only checked participants count.")}<p class="plan-notice" data-share-total></p><div class="plan-error" role="alert"></div><button class="button primary" type="submit">Save actual expense</button></form>`,
            );
            updateShares();
        }
        function repaymentForm(from, to, amount) {
            a.openDialog(
                "Record a repayment",
                "This records a payment already made; it doesn't transfer money.",
                `<form data-memory-form="repayment">${field("Paid by", `<select name="from">${memberOptions(from || a.memberId())}</select>`)}${field("Paid to", `<select name="to">${memberOptions(to || s().members.find((m) => m.id !== a.memberId())?.id)}</select>`)}${field("Amount (₹)", `<input name="amount" type="number" min="0.01" max="1000000" step="0.01" value="${amount ? amount / 100 : ""}" required>`)}${field("Note (optional)", '<input name="note" maxlength="200" placeholder="UPI / cash, date…">')}<label class="checkbox-field"><input type="checkbox" name="paid" required>This payment has actually been made.</label><div class="plan-error" role="alert"></div><button class="button primary" type="submit">Record repayment</button></form>`,
            );
        }
        function scrapbook() {
            const visited = C.orderedStops(s()).filter((p) => s().visits[p.id]);
            return panel(
                "The things we'll remember",
                notice(
                    window.PlanmateSite?.deviceOnly
                        ? "Keep your visited stops and notes together. Photo uploads are unavailable on this site."
                        : "A shared scrapbook of your own photos and captions. Venue-provider photos are never copied here.",
                ) +
                    (!a.groupCode()
                        ? notice(
                              window.PlanmateSite?.deviceOnly
                                  ? "Your visited stops and notes remain saved in this browser."
                                  : "Create a shared trip to add photos with your friends. Your visited stops and notes remain saved on this device.",
                          )
                        : notice(
                              "JPEG or PNG · up to 5 MB each · up to 100 photos per trip. Visible only with trip membership; authors control their photos and captions.",
                          )) +
                    (visited.length
                        ? `<div class="scrapbook-grid">${visited
                              .map((p) => {
                                  const photos = s().scrapbook.filter((x) => x.stopId === p.id);
                                  return `<article class="scrapbook-stop"><span class="paper-tape" aria-hidden="true"></span><h3>${esc(a.displayPlace(p.place).name)}</h3>${notice(`${p.date} · Visited, marked by ${a.memberName(s().visits[p.id].by)}`)}${photos.length ? photos.map((photo) => `<figure class="scrapbook-photo"><div data-photo-id="${esc(photo.id)}" class="photo-frame">${images.has(photo.id) ? `<img src="${esc(images.get(photo.id))}" alt="${esc(photo.caption || "Trip photo by " + a.memberName(photo.by))}">` : `<p class="plan-notice">${loading.has(photo.id) ? "Loading photo…" : "Photo ready to load"}</p>`}</div><figcaption>${esc(photo.caption || "A moment worth keeping.")}</figcaption>${notice(`${a.memberName(photo.by)} · ${new Date(photo.createdAt).toLocaleString("en-IN", { timeZone: s().trip.timezone })}`)}${photo.by === a.memberId() ? `<div class="plan-row">${button("edit-caption", "Edit caption", photo.id)}${button("delete-photo", "Delete my photo", photo.id)}</div>` : ""}</figure>`).join("") : `<div class="memory-placeholder"><span aria-hidden="true">✧</span><p>No photo yet. The visit is still part of your story.</p>${p.note ? notice(p.note) : ""}</div>`}${a.groupCode() ? button("upload", "Add my photo & caption", p.id) : ""}</article>`;
                              })
                              .join("")}</div>`
                        : notice(
                              "No visited stops yet. Mark a stop as group visited in Itinerary or Today, then add a memory.",
                          )),
            );
        }
        async function loadPhotos() {
            const code = a.groupCode();
            if (!code) return;
            const currentTarget = (id) =>
                [...document.querySelectorAll("[data-photo-id]")].find(
                    (p) => p.dataset.photoId === id,
                );
            function showError(id, message) {
                if (a.groupCode() !== code) return;
                const target = currentTarget(id);
                if (!target) return;
                target.textContent = message;
                const retry = document.createElement("button");
                retry.className = "button secondary small";
                retry.type = "button";
                retry.textContent = "Retry photo";
                retry.dataset.planAction = "retry-photo";
                retry.dataset.id = id;
                target.append(retry);
            }
            for (const target of document.querySelectorAll("[data-photo-id]")) {
                const id = target.dataset.photoId;
                if (images.has(id) || loading.has(id)) continue;
                loading.add(id);
                target.textContent = "Loading photo…";
                try {
                    const blob = await a.blobRequest(`/api/groups/${code}/photos/${id}`);
                    if (a.groupCode() !== code || !s().scrapbook.some((p) => p.id === id)) continue;
                    const url = URL.createObjectURL(blob);
                    images.set(id, url);
                    const latest = currentTarget(id);
                    if (latest) {
                        latest.replaceChildren();
                        const img = document.createElement("img");
                        img.src = url;
                        img.alt = s().scrapbook.find((p) => p.id === id)?.caption || "Trip photo";
                        latest.append(img);
                        img.addEventListener(
                            "error",
                            () => {
                                if (images.get(id) === url) images.delete(id);
                                URL.revokeObjectURL(url);
                                showError(
                                    id,
                                    "Photo could not be displayed. Choose a valid photo.",
                                );
                            },
                            { once: true },
                        );
                    }
                } catch (e) {
                    showError(id, e.message);
                } finally {
                    loading.delete(id);
                }
            }
        }
        function render(view) {
            const code = a.groupCode();
            if (group !== code) {
                for (const url of images.values()) URL.revokeObjectURL(url);
                images = new Map();
                loading.clear();
                group = code;
            }
            for (const [id, url] of images) {
                if (!s().scrapbook.some((p) => p.id === id)) {
                    URL.revokeObjectURL(url);
                    images.delete(id);
                }
            }
            if (view === "expenses") document.getElementById("workspace").innerHTML = moneyPanel();
            if (view === "scrapbook") {
                document.getElementById("workspace").innerHTML = scrapbook();
                loadPhotos();
            }
        }
        function updateShares() {
            const f = document.querySelector('[data-memory-form="expense"]');
            if (!f) return;
            const d = new FormData(f),
                checked = d.getAll("participants"),
                total = checked.reduce(
                    (n, id) => n + Math.round(Number(d.get(`share-${id}`) || 0) * 100),
                    0,
                );
            f.querySelector("[data-share-total]").textContent =
                d.get("split") === "custom"
                    ? `Custom total: ${rupees(total)} · expense total: ${rupees(Math.round(Number(d.get("amount") || 0) * 100))}`
                    : `Equal split among ${checked.length} participating member(s).`;
            f.querySelectorAll(".share-input").forEach(
                (input) =>
                    (input.disabled =
                        d.get("split") !== "custom" || !checked.includes(input.name.slice(6))),
            );
        }
        document.addEventListener("input", updateShares);
        document.addEventListener("change", updateShares);
        document.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-plan-action]");
            if (!b || b.disabled) return;
            const id = b.dataset.id;
            try {
                switch (b.dataset.planAction) {
                    case "add-expense":
                        expenseForm();
                        break;
                    case "edit-expense":
                        expenseForm(id);
                        break;
                    case "delete-expense":
                        a.openDialog(
                            "Delete this expense?",
                            "Balances will be recalculated. Repayment records stay separate.",
                            `<form data-memory-form="delete-expense" data-id="${esc(id)}"><div class="plan-error" role="alert"></div><button class="button primary" type="submit">Delete expense record</button></form>`,
                        );
                        break;
                    case "add-repayment":
                        repaymentForm();
                        break;
                    case "suggested-repayment":
                        repaymentForm(id, b.dataset.to, Number(b.dataset.amount));
                        break;
                    case "delete-repayment":
                        await run(
                            "deleteRepayment",
                            { id },
                            "Repayment record removed; balances updated.",
                        );
                        break;
                    case "upload":
                        a.openDialog(
                            "Keep this memory",
                            "Upload your own photo from this visited stop.",
                            `<form data-memory-form="upload" data-id="${esc(id)}">${field("Your photo", '<input name="photo" type="file" accept="image/jpeg,image/png" required>')}${field("Caption (optional)", '<textarea name="caption" maxlength="500" rows="3"></textarea>')}<label class="checkbox-field"><input name="own" type="checkbox" required>This is my photo and I'm happy to share it with the trip members.</label><div class="plan-error" role="alert"></div><button class="button primary" type="submit">Upload to our scrapbook</button></form>`,
                        );
                        break;
                    case "edit-caption": {
                        const p = s().scrapbook.find((p) => p.id === id);
                        a.openDialog(
                            "A few words for this memory",
                            "Your caption is shared with trip members.",
                            `<form data-memory-form="caption" data-id="${esc(id)}">${field("Caption", `<textarea name="caption" maxlength="500">${esc(p.caption)}</textarea>`)}<div class="plan-error" role="alert"></div><button class="button primary" type="submit">Save caption</button></form>`,
                        );
                        break;
                    }
                    case "delete-photo":
                        a.openDialog(
                            "Delete your photo?",
                            "This removes your upload and caption from the shared scrapbook.",
                            `<form data-memory-form="delete-photo" data-id="${esc(id)}"><div class="plan-error" role="alert"></div><button class="button primary" type="submit">Delete my uploaded photo</button></form>`,
                        );
                        break;
                    case "retry-photo":
                        loadPhotos();
                        break;
                }
            } catch (error) {
                a.toast(error.message);
            }
        });
        document.addEventListener("submit", async (e) => {
            const f = e.target;
            if (!f.dataset.memoryForm) return;
            e.preventDefault();
            const data = new FormData(f),
                d = Object.fromEntries(data),
                submit = f.querySelector('[type="submit"]');
            submit.disabled = true;
            try {
                switch (f.dataset.memoryForm) {
                    case "expense": {
                        const participants = data.getAll("participants"),
                            shares = Object.fromEntries(
                                participants.map((id) => [
                                    id,
                                    Math.round(Number(data.get(`share-${id}`) || 0) * 100),
                                ]),
                            );
                        await run(
                            f.dataset.id ? "editExpense" : "addExpense",
                            {
                                id: f.dataset.id || uid(),
                                description: d.description,
                                payer: d.payer,
                                amountPaise: Math.round(Number(d.amount) * 100),
                                participants,
                                split: d.split,
                                shares,
                            },
                            "Actual expense saved; balances updated.",
                        );
                        a.closeDialog();
                        break;
                    }
                    case "repayment":
                        await run(
                            "addRepayment",
                            {
                                id: uid(),
                                from: d.from,
                                to: d.to,
                                amountPaise: Math.round(Number(d.amount) * 100),
                                note: d.note,
                            },
                            "Repayment recorded separately from expenses.",
                        );
                        a.closeDialog();
                        break;
                    case "delete-expense":
                        await run("deleteExpense", { id: f.dataset.id });
                        a.closeDialog();
                        break;
                    case "caption":
                        await run("editCaption", { id: f.dataset.id, caption: d.caption });
                        a.closeDialog();
                        break;
                    case "delete-photo":
                        await run(
                            "deletePhoto",
                            { id: f.dataset.id },
                            "Your uploaded photo was removed.",
                        );
                        a.closeDialog();
                        break;
                    case "upload": {
                        const file = data.get("photo");
                        if (
                            !file ||
                            !file.size ||
                            file.size > (a.photoLimitBytes?.() || 5 * 1024 * 1024) ||
                            !["image/jpeg", "image/png"].includes(file.type)
                        )
                            throw new Error(
                                "Choose a JPEG or PNG photo up to " +
                                    (a.photoLimitBytes?.() || 5 * 1024 * 1024) / (1024 * 1024) +
                                    " MB.",
                            );
                        submit.textContent = "Uploading photo…";
                        await a.uploadPhoto(file, { stopId: f.dataset.id, caption: d.caption });
                        a.closeDialog();
                        a.toast("Your memory is in the shared scrapbook.");
                        break;
                    }
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
                if (f.dataset.memoryForm === "upload")
                    submit.textContent = "Upload to our scrapbook";
            }
        });
        return { render };
    }
    window.MemoriesUI = { init };
})();
