"use strict";
(() => {
    const button = document.getElementById("refreshConnections"),
        message = document.getElementById("connectionMessage"),
        list = document.getElementById("connectionList");
    async function refresh() {
        button.disabled = true;
        list.setAttribute("aria-busy", "true");
        message.textContent = "Checking this server…";
        list.replaceChildren();
        try {
            if (location.protocol === "file:")
                throw new Error(
                    "Connection status needs the Planmate server. Open this guide from your hosted website.",
                );
            const response = await fetch("/api/integrations/status", {
                cache: "no-store",
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok)
                throw new Error("The server could not report its connections. Try Refresh status.");
            const data = await response.json();
            if (!Array.isArray(data.services) || !data.services.length)
                throw new Error("No connection information was returned. Try Refresh status.");
            for (const service of data.services) {
                const item = document.createElement("li"),
                    title = document.createElement("strong"),
                    status = document.createElement("span"),
                    explanation = document.createElement("p");
                title.textContent = service.name;
                status.textContent =
                    service.status + (service.provider ? " · " + service.provider : "");
                explanation.textContent = service.fallback;
                item.append(title, status, explanation);
                list.append(item);
            }
            message.textContent = `${data.accountMode}. Checked ${new Date(data.checkedAt).toLocaleTimeString()}.`;
        } catch (error) {
            message.textContent =
                error.name === "TimeoutError"
                    ? "The server took too long. Try Refresh status when your connection returns."
                    : error.message || "Connection status is unavailable. Try Refresh status.";
        } finally {
            button.disabled = false;
            list.setAttribute("aria-busy", "false");
        }
    }
    button.addEventListener("click", refresh);
    refresh();
})();
