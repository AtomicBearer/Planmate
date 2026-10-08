(() => {
    "use strict";
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!window.IntersectionObserver || !window.MutationObserver) return;
    const selector =
        ".hero-copy,.section-heading,.place-card,.idea-card,.stop-card,.member-card,.profile-intro > div:first-child,.profile-panel,.identity-card,.wish-card,.form-heading,.login-card,.plan-preview";
    const observed = new WeakSet(),
        seen = new Set();
    // Stable keys avoid replaying card entrances when a save, vote or shared
    // refresh redraws existing content. Fresh search results still get an entrance.
    function key(element) {
        const control = element.querySelector("[data-id],[data-wish]");
        const id = element.dataset.wish || control?.dataset.id || control?.dataset.wish;
        return id
            ? `${element.classList.contains("place-card") ? "place" : element.classList.contains("wish-card") ? "wish" : "plan"}:${id}`
            : "";
    }
    const observer = new IntersectionObserver(
        (entries) => {
            let order = 0;
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                observer.unobserve(entry.target);
                const identity = key(entry.target);
                if (preference.matches || (identity && seen.has(identity))) continue;
                if (identity) seen.add(identity);
                entry.target.style.setProperty("--motion-delay", `${Math.min(order++, 4) * 35}ms`);
                entry.target.classList.add("motion-enter");
            }
        },
        { threshold: 0.08 },
    );
    function register(root) {
        const candidates = root.matches?.(selector)
            ? [root, ...root.querySelectorAll(selector)]
            : [...root.querySelectorAll(selector)];
        for (const element of candidates)
            if (!observed.has(element)) {
                observed.add(element);
                observer.observe(element);
            }
    }
    register(document);
    const mutations = new MutationObserver((records) => {
        for (const record of records)
            for (const node of record.addedNodes)
                if (node.nodeType === Node.ELEMENT_NODE) register(node);
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("animationend", (event) => {
        if (event.animationName === "paper-arrive") event.target.classList.remove("motion-enter");
    });
    preference.addEventListener("change", () => {
        if (preference.matches)
            document
                .querySelectorAll(".motion-enter")
                .forEach((element) => element.classList.remove("motion-enter"));
    });
})();
