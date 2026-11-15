/* Train legs share the same persistence and conflict handling as activities. */
(function () {
    "use strict";
    const C = window.PlannerCore,
        esc = window.PlanmateUtils.escapeHtml;
    function init(a, { field, panel, notice, run }) {
        const button = (action, label, id = "") =>
            '<button type="button" class="button secondary small" data-train-action="' +
            action +
            '" data-id="' +
            esc(id) +
            '">' +
            label +
            "</button>";
        function render(view) {
            if (!["itinerary", "today"].includes(view)) return;
            document.getElementById("trainJourneys")?.remove();
            const legs = [...(a.state().journeys || [])].sort((x, y) =>
                (x.departureDate + x.departureTime).localeCompare(
                    y.departureDate + y.departureTime,
                ),
            );
            const body =
                notice(
                    "Getting there, coming home, or moving between cities. All times are entered by your group in IST. Rail fares are separate from activity estimates.",
                ) +
                legs
                    .map((leg) => {
                        const canEdit =
                            leg.by === a.memberId() || a.state().organizerId === a.memberId();
                        return (
                            '<article class="plan-panel"><h3>' +
                            esc(leg.from) +
                            " → " +
                            esc(leg.to) +
                            "</h3>" +
                            notice((leg.train || "Train to be confirmed") + " · " + leg.status) +
                            '<div class="form-row"><p><strong>Departs</strong><br>' +
                            esc(leg.departureDate) +
                            " · " +
                            esc(leg.departureTime || "Time unknown") +
                            " IST</p><p><strong>Arrives</strong><br>" +
                            esc(leg.arrivalDate) +
                            " · " +
                            esc(leg.arrivalTime || "Time unknown") +
                            " IST</p></div>" +
                            (leg.note ? notice(leg.note) : "") +
                            notice("Added by " + a.memberName(leg.by)) +
                            (canEdit
                                ? '<div class="plan-row">' +
                                  button("edit", "Edit journey", leg.id) +
                                  button("remove", "Remove journey", leg.id) +
                                  "</div>"
                                : "") +
                            "</article>"
                        );
                    })
                    .join("") +
                (!legs.length
                    ? notice(
                          "No trains added yet. You can keep times blank until you choose your train.",
                      )
                    : "") +
                button("add", "+ Add train journey");
            document
                .getElementById("workspace")
                .insertAdjacentHTML(
                    "afterbegin",
                    '<div id="trainJourneys">' +
                        panel("The journey is part of the trip", body) +
                        "</div>",
                );
        }
        function open(leg = {}) {
            const input = (name, type = "text", required = false, max = 100) =>
                '<input name="' +
                name +
                '" type="' +
                type +
                '" value="' +
                esc(leg[name] || "") +
                '" maxlength="' +
                max +
                '"' +
                (required ? " required" : "") +
                ">";
            a.openDialog(
                leg.id ? "Edit train journey" : "Add a train journey",
                "Choose the actual arrival date for an overnight train. Dates can sit outside your days in the city.",
                '<form data-train-form="journey" data-id="' +
                    esc(leg.id || "") +
                    '">' +
                    '<div class="form-row">' +
                    field(
                        "From station",
                        input("from", "text", true),
                        "Enter the Mumbai station on your ticket.",
                    ) +
                    field(
                        "To station",
                        input("to", "text", true),
                        "Kadur (DRU) or Birur (RRB), if applicable.",
                    ) +
                    "</div>" +
                    field("Train name / number (optional)", input("train")) +
                    '<div class="form-row">' +
                    field("Departure date", input("departureDate", "date", true)) +
                    field("Departure time · IST (optional)", input("departureTime", "time")) +
                    "</div>" +
                    '<div class="form-row">' +
                    field("Arrival date", input("arrivalDate", "date", true)) +
                    field("Arrival time · IST (optional)", input("arrivalTime", "time")) +
                    "</div>" +
                    field(
                        "Booking status",
                        '<select name="status">' +
                            ["tentative", "booked", "cancelled"]
                                .map(
                                    (status) =>
                                        "<option" +
                                        (leg.status === status ? " selected" : "") +
                                        ">" +
                                        status +
                                        "</option>",
                                )
                                .join("") +
                            "</select>",
                    ) +
                    field(
                        "Shared note (optional)",
                        '<textarea name="note" maxlength="500" rows="3">' +
                            esc(leg.note || "") +
                            "</textarea>",
                        "Visible to trip members. Keep ticket identifiers and personal documents private.",
                    ) +
                    '<p class="plan-error" role="alert"></p><button type="submit" class="button primary">Save journey</button></form>',
            );
        }
        document.addEventListener("click", (event) => {
            const target = event.target.closest("[data-train-action]");
            if (!target) return;
            const leg = a.state().journeys?.find((item) => item.id === target.dataset.id);
            if (target.dataset.trainAction === "add") return open();
            if (!leg) return a.toast("This journey has changed. Refresh the plan.");
            if (target.dataset.trainAction === "edit") return open(leg);
            a.openDialog(
                "Remove this journey?",
                leg.from + " → " + leg.to,
                '<form data-train-form="remove" data-id="' +
                    esc(leg.id) +
                    '">' +
                    notice(
                        "This removes the train from the shared plan. It does not cancel a ticket.",
                    ) +
                    '<p class="plan-error" role="alert"></p><button type="submit" class="button primary">Remove journey</button></form>',
            );
        });
        document.addEventListener("submit", async (event) => {
            const form = event.target.closest("[data-train-form]");
            if (!form) return;
            event.preventDefault();
            const submit = form.querySelector('[type="submit"]');
            if (submit.disabled) return;
            submit.disabled = true;
            try {
                const remove = form.dataset.trainForm === "remove";
                const value = Object.fromEntries(new FormData(form));
                value.id = form.dataset.id || window.PlanmateUtils.uniqueId();
                await run(
                    remove ? "removeJourney" : form.dataset.id ? "editJourney" : "addJourney",
                    value,
                    remove ? "Journey removed." : "Train journey saved.",
                );
                document.dispatchEvent(
                    new CustomEvent("planmate:form-saved", { detail: { form } }),
                );
                a.closeDialog();
            } catch (error) {
                form.querySelector(".plan-error").textContent = error.message;
            } finally {
                submit.disabled = false;
            }
        });
        return { render };
    }
    window.TrainUI = { init };
})();
