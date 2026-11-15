/* The source app uses its Node server. Folder uploads deliberately use device storage. */
(() => {
    "use strict";
    const deviceOnly =
        document.querySelector('meta[name="planmate-storage"]')?.content === "device";
    window.PlanmateSite = Object.freeze({ deviceOnly });
})();
