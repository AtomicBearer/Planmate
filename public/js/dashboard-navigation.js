/* URL context and accessible section selection, independent of planner mutations. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.PlanmateNavigation = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const views = {
        group: "Dates & attendance",
        discover: "Explore places",
        ideas: "Group ideas",
        fit: "Plans that fit",
        itinerary: "Our itinerary",
        today: "Today's plan",
        expenses: "Actual expenses",
        scrapbook: "Our scrapbook",
        saved: "Saved places",
    };
    function context({ view, day, group, space }) {
        const params = new URLSearchParams({ view });
        if (day) params.set("day", day);
        if (group) params.set("group", group);
        else if (space) params.set("space", space);
        return params;
    }
    function render(view) {
        document.getElementById("mobileView").value = view;
        document.querySelectorAll(".nav-item").forEach((b) => {
            b.classList.toggle("active", b.dataset.view === view);
            if (b.dataset.view === view) b.setAttribute("aria-current", "page");
            else b.removeAttribute("aria-current");
        });
        document.querySelectorAll('[role="tab"]').forEach((b) => {
            const selected = b.dataset.view === view;
            b.setAttribute("aria-selected", String(selected));
            b.tabIndex = selected ? 0 : -1;
        });
        const tabs = ["discover", "ideas", "itinerary"].includes(view),
            mount = document.getElementById("workspace");
        document.querySelector(".view-tabs").hidden = !tabs;
        mount.setAttribute("role", tabs ? "tabpanel" : "region");
        if (tabs) {
            mount.setAttribute("aria-labelledby", "tab-" + view);
            mount.removeAttribute("aria-label");
        } else {
            mount.removeAttribute("aria-labelledby");
            mount.setAttribute("aria-label", views[view]);
        }
    }
    function update(params) {
        if (location.protocol !== "file:")
            history.replaceState({}, "", location.pathname + "?" + params);
    }
    return { views, context, render, update };
});
