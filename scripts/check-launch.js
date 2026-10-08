"use strict";
const path = require("node:path");
function httpsEndpoint(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
    } catch {
        return false;
    }
}
function checkLaunch(env = process.env) {
    const errors = [],
        warnings = [];
    if (env.HOST !== "0.0.0.0")
        errors.push("Set HOST=0.0.0.0 so the host can reach the Node server.");
    if (
        !httpsEndpoint(env.PUBLIC_ORIGIN) ||
        new URL(env.PUBLIC_ORIGIN).origin !== env.PUBLIC_ORIGIN
    )
        errors.push(
            "Set PUBLIC_ORIGIN to the exact public HTTPS origin, without a path or trailing slash.",
        );
    if (env.SESSION_SECURE !== "true")
        errors.push("Set SESSION_SECURE=true for public HTTPS sign-in.");
    if (env.ACCOUNT_MODE !== "required")
        warnings.push(
            "Guest access is enabled: names are unverified and discovery is public. Set ACCOUNT_MODE=required for verified public accounts.",
        );
    if (
        env.ACCOUNT_MODE === "required" &&
        !/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID || "")
    )
        errors.push("Required accounts need a Google Web client ID in GOOGLE_CLIENT_ID.");
    if (env.PORT && (!/^\d+$/.test(env.PORT) || Number(env.PORT) < 1 || Number(env.PORT) > 65535))
        errors.push("PORT must be an integer from 1 to 65535.");
    const publicRoot = path.resolve(__dirname, "..", "public");
    if (!env.PLANMATE_DATA_DIR || !path.isAbsolute(env.PLANMATE_DATA_DIR))
        errors.push(
            "Set PLANMATE_DATA_DIR to an absolute directory on the host's persistent disk.",
        );
    else {
        const dataRoot = path.resolve(env.PLANMATE_DATA_DIR);
        if (dataRoot === publicRoot || dataRoot.startsWith(publicRoot + path.sep))
            errors.push("PLANMATE_DATA_DIR must be outside public/.");
    }
    for (const key of ["EVENTS_FEED_URL", "ROUTES_FEED_URL"])
        if (env[key] && !httpsEndpoint(env[key]))
            errors.push(`${key} must be an HTTPS URL without embedded credentials.`);
    if (!env.GOOGLE_PLACES_API_KEY)
        warnings.push("Live places/photos are unconfigured; starter references remain available.");
    if (!env.GOOGLE_STATIC_MAPS_API_KEY)
        warnings.push(
            "Google map backgrounds are unconfigured; directions links remain available.",
        );
    if (!env.GOOGLE_ROUTES_API_KEY && !env.ROUTES_FEED_URL)
        warnings.push("Routes are unconfigured; travel buffers remain manual estimates.");
    if (!env.EVENTS_FEED_URL && !env.TICKETMASTER_API_KEY)
        warnings.push("Live events are unconfigured; no listings will be fabricated.");
    warnings.push(
        "Confirm persistent disk, one running Node instance, registered Google origins and provider quotas on the host. Configuration checks do not test live credentials.",
    );
    return { errors, warnings };
}
if (require.main === module) {
    const { errors, warnings } = checkLaunch();
    console.log(
        "Planmate public-link preflight · no external requests and no credential values printed.",
    );
    errors.forEach((message) => console.log("NEEDS FIX: " + message));
    warnings.forEach((message) => console.log("REVIEW: " + message));
    console.log(
        errors.length
            ? `${errors.length} public configuration issue(s) remain.`
            : "Configuration checks passed. Test the deployed journey before presenting.",
    );
    process.exitCode = errors.length ? 1 : 0;
}
module.exports = { checkLaunch };
