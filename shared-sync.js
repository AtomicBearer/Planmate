/* Never replace a newer revision with a delayed refresh or a different member's response. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.PlanmateSync = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    function create(a) {
        let pending = false,
            timer = null;
        async function refresh(force = false) {
            const context = a.context();
            if (!context.code || pending || (a.busy() && !force)) return;
            pending = true;
            try {
                const result = await a.request("/api/groups/" + context.code);
                if (JSON.stringify(context) !== JSON.stringify(a.context())) return;
                if (result.state.revision > a.revision()) a.receive(result.state);
                a.status("Shared · up to date");
            } catch (error) {
                if (JSON.stringify(context) === JSON.stringify(a.context())) a.error(error);
            } finally {
                pending = false;
            }
        }
        function focus() {
            refresh();
        }
        function start() {
            if (timer) return;
            timer = setInterval(() => {
                if (!document.hidden) refresh();
            }, 4000);
            window.addEventListener("focus", focus);
        }
        function stop() {
            if (timer) clearInterval(timer);
            timer = null;
            window.removeEventListener("focus", focus);
        }
        return { refresh, start, stop };
    }
    return { create };
});
