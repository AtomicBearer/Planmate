/* Small browser helpers shared by the planner and profile pages. */
(function (root, factory) {
    "use strict";
    const helpers = factory(root);
    if (typeof module === "object" && module.exports) module.exports = helpers;
    else root.PlanmateUtils = helpers;
})(typeof window === "object" ? window : globalThis, function (root) {
    "use strict";
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
    }

    // Invalid JSON and blocked browser storage both fall back without breaking a page.
    function readJson(key, fallback, storage) {
        try {
            return JSON.parse((storage ?? root.localStorage).getItem(key)) ?? fallback;
        } catch {
            return fallback;
        }
    }

    function uniqueId() {
        return typeof root.crypto?.randomUUID === "function"
            ? root.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const captureImages = (mount) =>
        new Map(
            [...mount.querySelectorAll("img[src]")].map((img) => [img.getAttribute("src"), img]),
        );
    function replaceHtml(mount, html, images = captureImages(mount)) {
        const template = root.document.createElement("template");
        template.innerHTML = html;
        for (const img of template.content.querySelectorAll("img[src]")) {
            const existing = images.get(img.getAttribute("src"));
            if (existing && existing.alt === img.alt) img.replaceWith(existing);
        }
        mount.replaceChildren(template.content);
    }
    return Object.freeze({ escapeHtml, readJson, uniqueId, captureImages, replaceHtml });
});
