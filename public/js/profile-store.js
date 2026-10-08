/* Personal travel profiles are kept per signed-in email, or per browser for guests. */
(function (root) {
    "use strict";
    const KEY = "planmateProfilesV1";
    const { hobbies, places, options, colours } = root.PlanmateProfileRules;
    const read = root.PlanmateUtils.readJson;
    function account() {
        const verified = root.PlanmateAccount?.account();
        if (verified)
            return { name: verified.name, email: verified.email, loginMethod: "verified-google" };
        const value = read("PlanmateUser", null) || read("plansyncUser", null);
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    function identity() {
        const verified = root.PlanmateAccount?.account();
        if (verified) return `account:${verified.id}`;
        const user = account();
        return typeof user.email === "string" && user.email.trim()
            ? `email:${user.email.trim().toLowerCase()}`
            : "guest:browser";
    }
    const short = (v, max, fallback = "") =>
        typeof v === "string" ? v.trim().slice(0, max) : fallback;
    const normalise = (v, fallback = "You") =>
        root.PlanmateProfileRules.normalise(v, account().name || fallback);
    function load(fallbackName = "You") {
        const verified = root.PlanmateAccount?.account();
        if (verified) return normalise(verified.profile, verified.name);
        const records = read(KEY, {}),
            user = account();
        const stored = records && typeof records === "object" ? records[identity()] : null;
        return normalise(stored || { name: short(user.name, 60) || fallbackName }, fallbackName);
    }
    function save(profile) {
        if (root.PlanmateAccount?.account())
            return root.PlanmateAccount.saveProfile(normalise(profile));
        const result = normalise(profile),
            existing = read(KEY, {});
        const records =
            existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
        result.updatedAt = new Date().toISOString();
        records[identity()] = result;
        localStorage.setItem(KEY, JSON.stringify(records));
        const user = account();
        if (Object.keys(user).length)
            localStorage.setItem(
                read("PlanmateUser", null) ? "PlanmateUser" : "plansyncUser",
                JSON.stringify({ ...user, name: result.name }),
            );
        return result;
    }
    root.PlanmateProfile = {
        KEY,
        hobbies,
        places,
        options,
        colours,
        account,
        identity,
        load,
        save,
        normalise,
        localProfile() {
            const local = read("PlanmateUser", null) || read("plansyncUser", null) || {};
            const key =
                typeof local.email === "string" && local.email.trim()
                    ? `email:${local.email.trim().toLowerCase()}`
                    : "guest:browser";
            return root.PlanmateProfileRules.normalise(
                read(KEY, {})[key] || {},
                local.name || "You",
            );
        },
    };
})(window);
