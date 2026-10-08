"use strict";

// Configuration only: never expose credentials or claim a live request succeeded.
function describeIntegrations({ accounts, discovery, maps }) {
    return {
        checkedAt: new Date().toISOString(),
        liveVerified: false,
        accountMode: accounts.required ? "Verified accounts required" : "Demo access enabled",
        services: [
            {
                id: "accounts",
                name: "Google sign-in",
                configured: accounts.configured,
                fallback: "Unverified demo profiles stay on this browser.",
            },
            {
                id: "places",
                name: "Live places & venue photos",
                configured: discovery.places,
                fallback: "Starter references and sourced manual suggestions are available.",
            },
            {
                id: "maps",
                name: "Google map backgrounds",
                configured: maps.googleMap,
                fallback:
                    "Sourced locations and directions links remain available; Google locations require a configured Google map.",
            },
            {
                id: "routes",
                name: "Connected route checks",
                configured: maps.routes,
                provider: maps.routeProvider,
                fallback: "Clearly labelled manual travel buffers remain available.",
            },
            {
                id: "events",
                name: "Live events",
                configured: discovery.events,
                provider: discovery.eventProvider,
                fallback:
                    "No live listings are fabricated. Members can add sourced events manually.",
            },
        ].map((service) => ({
            ...service,
            configured: Boolean(service.configured),
            status: service.configured ? "Configured · live check needed" : "Not connected",
        })),
        included: [
            "Shared planning",
            "Availability & attendance",
            "Explainable plan drafts",
            "Actual expense splitting",
            "Private trip scrapbook",
            "Local PDF export",
        ],
    };
}
module.exports = { describeIntegrations };
