/* Select real saved plans without creating or modifying trip data. */
(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory(require("../../shared/planner-core.js"));
    else root.PlanmateSpaces = factory(root.PlannerCore);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
    "use strict";
    function valid(entry) {
        try {
            Core.validateTrip(entry.state.trip);
            return (
                entry.state.version === 1 &&
                Array.isArray(entry.state.proposals) &&
                Array.isArray(entry.state.stops) &&
                entry.state.members.some((m) => m.id === entry.memberId && !m.removed)
            );
        } catch {
            return false;
        }
    }
    function entries(spaces, { includeLegacy = false } = {}) {
        if (!spaces || typeof spaces !== "object" || Array.isArray(spaces)) return [];
        // Older examples never open automatically; saved work remains explicitly accessible.
        return Object.entries(spaces).filter(
            ([, entry]) => valid(entry) && (includeLegacy || !entry.preview),
        );
    }
    function select(spaces, requested, active) {
        const available = entries(spaces);
        for (const id of [requested, active]) if (available.some(([key]) => key === id)) return id;
        return available[0]?.[0] || "";
    }
    return { valid, entries, select };
});
