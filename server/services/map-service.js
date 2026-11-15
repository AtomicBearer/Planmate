"use strict";
const crypto = require("node:crypto"),
    C = require("../../shared/planner-core.js");
const https = (v) => {
    try {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
    } catch {
        return "";
    }
};
function createMapService({
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    imageStore,
} = {}) {
    const key = env.GOOGLE_STATIC_MAPS_API_KEY,
        routeKey = env.GOOGLE_ROUTES_API_KEY,
        routeFeed = https(env.ROUTES_FEED_URL),
        images = imageStore || new Map();
    const config = () => ({
        googleMap: Boolean(key),
        routes: Boolean(routeFeed || routeKey),
        routeProvider: routeFeed ? "Connected route feed" : routeKey ? "Google Routes" : "",
    });
    async function coords(p, discovery, allowGoogle) {
        if (p.provider !== "google") return p.coordinates || null;
        if (!allowGoogle) return null;
        const { place } = await discovery.details(
            new URLSearchParams({ id: p.id, city: p.city, category: p.category }),
        );
        return place?.coordinates || null;
    }
    const project = (c) => {
        const lat = (Math.min(85.05112878, Math.max(-85.05112878, c.latitude)) * Math.PI) / 180;
        return {
            x: (c.longitude + 180) / 360,
            y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2,
        };
    };
    async function map(s, day, discovery, group) {
        C.check(C.dates(s.trip.start, s.trip.end).includes(day), "Choose a day within the trip.");
        const scheduled = C.orderedStops(s).filter((p) => p.date === day),
            pool = [
                ...scheduled.map((p) => ({ id: p.id, place: p.place, stop: true })),
                ...s.proposals
                    .filter(
                        (p) =>
                            p.status === "pending" && (!p.preferredDate || p.preferredDate === day),
                    )
                    .map((p) => ({ id: p.id, place: p.place, stop: false })),
            ].slice(0, 30);
        const points = [],
            missing = [];
        let googleRequests = 0;
        const found = await Promise.all(
            pool.map(async (p) => {
                if (p.place.provider === "google" && key && ++googleRequests > 10)
                    return {
                        missing: {
                            id: p.id,
                            reason: "Map refresh handles up to ten Google locations at a time; use the remaining directions links",
                        },
                    };
                try {
                    const c = await coords(p.place, discovery, Boolean(key));
                    return c
                        ? {
                              point: {
                                  id: p.id,
                                  placeId: p.place.id,
                                  stop: p.stop,
                                  latitude: c.latitude,
                                  longitude: c.longitude,
                                  source: c.source || p.place.source,
                              },
                          }
                        : {
                              missing: {
                                  id: p.id,
                                  reason:
                                      p.place.provider === "google" && !key
                                          ? "Google map display is not configured"
                                          : "Location coordinates unavailable",
                              },
                          };
                } catch {
                    return {
                        missing: { id: p.id, reason: "Current location could not be refreshed" },
                    };
                }
            }),
        );
        for (const entry of found) {
            if (entry.point) points.push(entry.point);
            else missing.push(entry.missing);
        }
        if (!points.length) return { points, missing, ...config() };
        const projected = points.map(project),
            xmin = Math.min(...projected.map((p) => p.x)),
            xmax = Math.max(...projected.map((p) => p.x)),
            ymin = Math.min(...projected.map((p) => p.y)),
            ymax = Math.max(...projected.map((p) => p.y)),
            center = { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
        const zoom = Math.min(
            16,
            Math.max(
                0,
                Math.floor(
                    Math.log2(
                        Math.min(
                            540 / (Math.max(xmax - xmin, 0.000001) * 256),
                            300 / (Math.max(ymax - ymin, 0.000001) * 256),
                        ),
                    ),
                ),
            ),
        );
        const world = 256 * 2 ** zoom;
        points.forEach((p, i) => {
            p.x = 320 + (projected[i].x - center.x) * world;
            p.y = 200 + (projected[i].y - center.y) * world;
            p.label = String(i + 1);
        });
        const result = { points, missing, ...config(), width: 640, height: 400 };
        if (key) {
            const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * center.y))) * 180) / Math.PI,
                lon = center.x * 360 - 180;
            const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
            url.search = new URLSearchParams({
                center: `${lat},${lon}`,
                zoom: String(zoom),
                size: "640x400",
                scale: "1",
                key,
            }).toString();
            const token = crypto.randomBytes(24).toString("base64url");
            if (!imageStore)
                for (const [t, v] of images) if (v.expires < now()) images.delete(t);
            if (images.size >= 200) throw new Error("Map previews are busy; try again shortly.");
            await images.set(token, { url: url.href, group, expires: now() + 600000 });
            result.imageToken = token;
        }
        return result;
    }
    async function image(token, group) {
        if (!/^[A-Za-z0-9_-]{32}$/.test(token || "")) throw new Error("Invalid map reference.");
        const resource = await images.get(token);
        if (!resource || resource.group !== group || resource.expires < now())
            throw new Error("Map preview expired. Refresh this day.");
        const response = await fetchImpl(resource.url, {
            redirect: "error",
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/"))
            throw new Error("Google map image unavailable. Check the server configuration.");
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 3000000) throw new Error("Map response too large.");
        return { bytes, type: response.headers.get("content-type") };
    }
    async function route(s, v, discovery) {
        if (!routeFeed && !routeKey)
            throw Object.assign(
                new Error(
                    "Route provider not connected. Keep your clearly labelled manual travel buffers.",
                ),
                { status: 503 },
            );
        const from = s.stops.find((p) => p.id === v.fromId),
            to = s.stops.find((p) => p.id === v.toId);
        C.check(from && to && from.id !== to.id, "Choose two different scheduled stops.");
        const a = await coords(from.place, discovery, true),
            b = await coords(to.place, discovery, true);
        C.check(a && b, "Coordinates are missing for one of these stops. Use a manual estimate.");
        if (!routeFeed) {
            let response;
            try {
                response = await fetchImpl(
                    "https://routes.googleapis.com/directions/v2:computeRoutes",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-Goog-Api-Key": routeKey,
                            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
                        },
                        body: JSON.stringify({
                            origin: {
                                location: {
                                    latLng: { latitude: a.latitude, longitude: a.longitude },
                                },
                            },
                            destination: {
                                location: {
                                    latLng: { latitude: b.latitude, longitude: b.longitude },
                                },
                            },
                            travelMode: "DRIVE",
                            routingPreference: "TRAFFIC_UNAWARE",
                            computeAlternativeRoutes: false,
                            units: "METRIC",
                        }),
                        redirect: "error",
                        signal: AbortSignal.timeout(8000),
                    },
                );
            } catch {
                throw new Error(
                    "Google Routes is unreachable. Retain your manual estimate and try again.",
                );
            }
            C.check(
                response.ok,
                "Google Routes rejected the request. Check the API key, enabled Routes API, billing and quota; retain your manual estimate.",
            );
            let data;
            try {
                data = await response.json();
            } catch {
                throw new Error(
                    "Google Routes returned an unreadable response. Retain your manual estimate.",
                );
            }
            const route = data.routes?.[0];
            C.check(
                route,
                "Google Routes found no driving route for these locations. Retain your manual estimate.",
            );
            C.check(
                typeof route.duration === "string" && /^\d+(?:\.\d+)?s$/.test(route.duration),
                "Google Routes did not supply a valid duration.",
            );
            const source = new URL("https://www.google.com/maps/dir/");
            source.search = new URLSearchParams({
                api: "1",
                origin: `${a.latitude},${a.longitude}`,
                destination: `${b.latitude},${b.longitude}`,
                travelmode: "driving",
            }).toString();
            return {
                durationSeconds: C.number(
                    Number(route.duration.slice(0, -1)),
                    "Route duration",
                    0,
                    86400,
                ),
                distanceMeters: C.number(route.distanceMeters, "Route distance", 0, 2000000),
                provider: "Google Routes · driving without traffic",
                sourceUrl: source.href,
                checkedAt: new Date(now()).toISOString(),
            };
        }
        const response = await fetchImpl(routeFeed, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(env.ROUTES_FEED_TOKEN
                    ? { Authorization: `Bearer ${env.ROUTES_FEED_TOKEN}` }
                    : {}),
            },
            body: JSON.stringify({
                from: a,
                to: b,
                date: to.date,
                arrivalTime: to.start,
                timezone: s.trip.timezone,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(8000),
        });
        C.check(response.ok, "Route provider unavailable; retain your manual estimate.");
        const data = await response.json();
        const source = https(data.sourceUrl);
        C.check(source, "The route provider did not supply a source link.");
        return {
            durationSeconds: C.number(data.durationSeconds, "Route duration", 0, 86400),
            distanceMeters: C.number(data.distanceMeters, "Route distance", 0, 2000000),
            provider: C.text(data.provider, "Route provider", 100),
            sourceUrl: source,
            checkedAt: new Date(now()).toISOString(),
        };
    }
    return { config, map, image, route };
}
module.exports = { createMapService };
