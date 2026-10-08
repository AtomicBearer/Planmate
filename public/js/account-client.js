/* Account sessions remain in HttpOnly cookies; only display data and CSRF live in memory. */
(function () {
    "use strict";
    let user = null,
        config = { configured: false, required: false, mode: "guest" },
        error = "";
    const headers = () => (user ? { "X-Planmate-CSRF": user.csrf } : {});
    async function call(path, options = {}) {
        let response;
        try {
            response = await fetch(path, {
                ...options,
                headers: { "Content-Type": "application/json", ...headers(), ...options.headers },
                signal: AbortSignal.timeout(8000),
            });
        } catch {
            throw new Error("Can't reach the account server. Your unfinished input is still here.");
        }
        const result = await response.json();
        if (!response.ok) {
            const e = new Error(result.error || "Account request failed.");
            e.status = response.status;
            throw e;
        }
        return result;
    }
    const ready = (async () => {
        if (location.protocol === "file:") return;
        try {
            config = await call("/api/auth/config");
            user = (await call("/api/auth/session")).account;
        } catch (e) {
            error = e.message;
        }
    })();
    window.PlanmateAccount = {
        ready,
        account: () => user,
        config: () => config,
        error: () => error,
        headers,
        call,
        acceptProfileRevision(revision) {
            if (user) user.profileRevision = revision;
        },
        async saveProfile(profile) {
            const result = await call("/api/profile", {
                method: "PUT",
                body: JSON.stringify({ profile, revision: user.profileRevision }),
            });
            user.profile = result.profile;
            user.profileRevision = result.revision;
            user.name = result.profile.name;
            return result.profile;
        },
        async signout(allDevices = false) {
            await call("/api/auth/signout", {
                method: "POST",
                body: JSON.stringify({ allDevices }),
            });
            user = null;
        },
    };
    document.addEventListener("click", async (e) => {
        const button = e.target.closest("[data-account-action],.logout");
        if (!button || !user) return;
        e.preventDefault();
        try {
            await window.PlanmateAccount.signout(button.dataset.accountAction === "signout-all");
            location.href = button.href || "login.html";
        } catch (error) {
            const target =
                document.getElementById("accountBanner") || document.getElementById("profileError");
            if (target) {
                target.textContent = error.message;
                target.hidden = false;
            }
        }
    });
})();
