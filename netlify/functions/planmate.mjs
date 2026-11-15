import { getStore } from "@netlify/blobs";
import api from "../../server/netlify-api.js";
import cache from "../../server/netlify-cache.js";
import discoveryService from "../../server/services/discovery.js";
import mapService from "../../server/services/map-service.js";

export default async (request, context) => {
    try {
        // Production data survives deploys; preview deploys use separate stores.
        const scope = context.deploy.context === "production" ? "production" : context.deploy.id;
        const store = name => getStore({ name: "planmate-" + scope + "-" + name, consistency: "strong" });
        const references = store("references");
        const discovery = discoveryService.createDiscovery({
            signingSecret: await cache.signingSecret(references),
            sessionStore: cache.discoverySessions(references)
        });
        const maps = mapService.createMapService({ imageStore: cache.mapImages(references) });
        return await api.createNetlifyApi({ store: store("trips"), media: store("photos"), discovery, maps })(request);
    } catch {
        return Response.json({ error: "Shared storage is unavailable. Try again shortly." },
            { status: 503, headers: { "Cache-Control": "no-store" } });
    }
};
export const config = {
    path: "/api/*",
    rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"], action: "rate_limit" }
};
