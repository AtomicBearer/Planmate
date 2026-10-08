"use strict";

const loginForm = document.getElementById("loginForm");
const fullNameInput = document.getElementById("fullName");
const emailInput = document.getElementById("email");
const contactInput = document.getElementById("contact");
const continueButton = document.getElementById("continueButton");
let continuing = false;

const fields = [
    {
        input: fullNameInput,
        error: document.getElementById("nameError"),
        valid: (value) => value.trim().length >= 2 && value.trim().length <= 60,
        message: "Please enter your name.",
    },
    {
        input: emailInput,
        error: document.getElementById("emailError"),
        valid: (value) =>
            value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
        message: "Please enter a valid email address.",
    },
    {
        input: contactInput,
        error: document.getElementById("contactError"),
        valid: (value) =>
            !value.trim() || /^[0-9]{7,15}$/.test(value.trim().replace(/[\s()+-]/g, "")),
        message: "Please enter a valid contact number.",
    },
];

function dashboardReturnUrl() {
    const requested = new URLSearchParams(window.location.search || ""),
        params = new URLSearchParams(),
        group = requested.get("group") || "";
    if (/^[A-Za-z0-9_-]{16}$/.test(group)) params.set("group", group);
    if (/^[A-Za-z0-9_-]{32}$/.test(requested.get("invite") || ""))
        params.set("invite", requested.get("invite"));
    else if (!group && /^[A-Za-z0-9_-]{1,100}$/.test(requested.get("space") || ""))
        params.set("space", requested.get("space"));
    if (
        [
            "group",
            "fit",
            "discover",
            "ideas",
            "itinerary",
            "today",
            "expenses",
            "scrapbook",
            "saved",
        ].includes(requested.get("view"))
    )
        params.set("view", requested.get("view"));
    const day = requested.get("day") || "";
    if (
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) &&
        new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day
    )
        params.set("day", day);
    return `dashboard.html${params.size ? `?${params}` : ""}`;
}

function validateForm() {
    let valid = true;
    for (const field of fields) {
        const invalid = !field.valid(field.input.value);
        field.error.textContent = invalid ? field.message : "";
        field.input.classList.toggle("invalid", invalid);
        if (invalid) valid = false;
    }
    return valid;
}

loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (continuing) return;
    if (window.PlanmateAccount?.config().required)
        return showToast(
            "Sign in required",
            "Use verified Google sign-in to access this server.",
            "!",
        );
    if (!validateForm()) {
        showToast("Check your details", "Please correct the highlighted fields.", "!");
        return;
    }

    // This prototype saves local display details. It does not authenticate an account.
    const user = {
        name: fullNameInput.value.trim(),
        email: emailInput.value.trim(),
        contact: contactInput.value.trim(),
        loginMethod: "local-profile",
    };
    try {
        localStorage.setItem("PlanmateUser", JSON.stringify(user));
    } catch {
        showToast(
            "Details couldn’t be saved",
            "Allow browser storage, then try again. Your details are still here.",
            "!",
        );
        return;
    }
    continuing = true;
    continueButton.disabled = true;
    showToast("Welcome to Planmate!", `Hello ${user.name}, your local profile is ready.`, "✓");
    setTimeout(() => {
        window.location.href = dashboardReturnUrl();
    }, 1200);
});

// Credentials are sent directly to the server; browser decoding never establishes identity.
async function handleCredentialResponse(response) {
    try {
        if (!window.PlanmateAccount?.config().configured)
            throw new Error("Verified sign-in is not configured on this server.");
        if (!response?.credential)
            throw new Error("Google did not return a credential. Try again.");
        await window.PlanmateAccount.call("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({ credential: response.credential }),
        });
        window.location.href = dashboardReturnUrl();
    } catch (error) {
        showToast("Sign-in unavailable", error.message, "!");
    }
}
if (window.PlanmateAccount)
    (async () => {
        await window.PlanmateAccount.ready;
        const cfg = window.PlanmateAccount.config(),
            status = document.getElementById("accountStatus");
        status.textContent =
            window.PlanmateAccount.error() ||
            (cfg.configured
                ? "Verified Google sign-in · profiles and trips follow your account."
                : "Verified sign-in is not configured. Local demo details stay on this browser.");
        if (cfg.required) loginForm.hidden = true;
        if (!cfg.configured) return;
        try {
            const challenge = await window.PlanmateAccount.call("/api/auth/challenge");
            if (!window.google?.accounts?.id)
                await new Promise((resolve, reject) => {
                    const script = document.querySelector(
                        'script[src="https://accounts.google.com/gsi/client"]',
                    );
                    script.addEventListener("load", resolve, { once: true });
                    script.addEventListener(
                        "error",
                        () =>
                            reject(
                                new Error("Google sign-in could not load. Reconnect and reload."),
                            ),
                        { once: true },
                    );
                    setTimeout(
                        () =>
                            window.google?.accounts?.id
                                ? resolve()
                                : reject(
                                      new Error("Google sign-in could not load. Reload to retry."),
                                  ),
                        10000,
                    );
                });
            window.google.accounts.id.initialize({
                client_id: cfg.clientId,
                nonce: challenge.nonce,
                callback: handleCredentialResponse,
                auto_select: false,
            });
            window.google.accounts.id.renderButton(document.getElementById("googleSignIn"), {
                type: "standard",
                theme: "outline",
                size: "large",
                text: "continue_with",
            });
        } catch (error) {
            status.textContent = error.message;
        }
    })();

function showToast(title, message, icon = "✓") {
    const toast = document.getElementById("toast");
    document.getElementById("toastTitle").textContent = title;
    document.getElementById("toastMessage").textContent = message;
    document.getElementById("toastIcon").textContent = icon;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
}

for (const { input } of fields) {
    input.addEventListener("input", () => input.classList.remove("invalid"));
}
