"use strict";
const crypto = require("node:crypto");
const Core = require("../../shared/planner-core.js");

// Multiple specific searches avoid the per-query result cap. Each click requests
// at most three pages; a city can yield hundreds of unique provider IDs.
const QUERIES = {
    Beach: ["beaches"],
    Food: ["cafes", "restaurants", "bakeries", "seafood restaurants"],
    Nightlife: ["night clubs", "bars", "live music venues"],
    Sights: ["tourist attractions", "museums", "historical landmarks", "local markets"],
    Outdoors: ["parks", "waterfalls", "hiking trails", "water sports"],
};
const EVENT_TYPES = [
    "All",
    "Comedy",
    "Music",
    "Theatre",
    "Sports",
    "Festival",
    "Workshop",
    "Other",
];
const FIELD_MASK =
    "places.id,places.displayName,places.formattedAddress,places.types,places.googleMapsUri,places.photos,places.attributions,places.businessStatus,places.location,nextPageToken";
const clean = (value, max) =>
    String(value || "")
        .trim()
        .slice(0, max);
const istDay = (now) => new Date(now + 19800000).toISOString().slice(0, 10);
function error(status, message) {
    return Object.assign(new Error(message), { status });
}
function httpsUrl(value) {
    try {
        const url = new URL(
            typeof value === "string" && value.startsWith("//") ? `https:${value}` : value,
        );
        return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
        return "";
    }
}
function createDiscovery({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    const secret = crypto.randomBytes(32),
        sessions = new Map();
    const key = env.GOOGLE_PLACES_API_KEY;
    const feed = httpsUrl(env.EVENTS_FEED_URL);
    const ticketKey = env.TICKETMASTER_API_KEY;
    const config = () => ({
        places: Boolean(key),
        events: Boolean(feed || ticketKey),
        eventProvider: feed ? "City events feed" : ticketKey ? "Ticketmaster" : "",
        eventTypes: EVENT_TYPES,
    });
    async function json(url, options = {}) {
        let response;
        try {
            response = await fetchImpl(url, {
                ...options,
                redirect: "error",
                signal: AbortSignal.timeout(6000),
            });
        } catch {
            throw error(502, "The discovery provider is unreachable. Try again shortly.");
        }
        if (!response.ok)
            throw error(
                502,
                response.status === 429
                    ? "The discovery provider's request limit was reached. Try again later."
                    : "The discovery provider rejected the request. Check the server's provider configuration.",
            );
        try {
            return await response.json();
        } catch {
            throw error(502, "The discovery provider returned an unreadable response.");
        }
    }
    function signPhoto(resource) {
        const value = Buffer.from(JSON.stringify({ resource, expires: now() + 600000 })).toString(
            "base64url",
        );
        return `${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
    }
    function googlePlace(value, city, category) {
        const id = clean(value.id, 80);
        if (
            !/^[A-Za-z0-9_-]+$/.test(id) ||
            !value.displayName?.text ||
            value.businessStatus === "CLOSED_PERMANENTLY"
        )
            return null;
        const types = value.types || [];
        if (category === "All") {
            category = types.includes("beach")
                ? "Beach"
                : types.some((t) => ["night_club", "bar"].includes(t))
                  ? "Nightlife"
                  : types.some((t) => ["cafe", "restaurant", "bakery"].includes(t))
                    ? "Food"
                    : types.some((t) =>
                            ["park", "hiking_area", "national_park", "campground"].includes(t),
                        )
                      ? "Outdoors"
                      : "Sights";
        }
        const photo = value.photos?.[0];
        return {
            id: `google-${id}`,
            provider: "google",
            fetchedAt: now(),
            name: clean(value.displayName.text, 100),
            city,
            area: clean(value.formattedAddress, 100) || city,
            category,
            duration: 90,
            description: "Discovered on Google Maps. Suggested duration is a planning estimate.",
            source:
                httpsUrl(value.googleMapsUri) ||
                `https://www.google.com/maps/search/?api=1&query=place&query_place_id=${encodeURIComponent(id)}`,
            custom: false,
            ...(Number.isFinite(value.location?.latitude) &&
            Math.abs(value.location.latitude) <= 90 &&
            Number.isFinite(value.location?.longitude) &&
            Math.abs(value.location.longitude) <= 180
                ? {
                      coordinates: {
                          latitude: value.location.latitude,
                          longitude: value.location.longitude,
                          source: httpsUrl(value.googleMapsUri),
                      },
                  }
                : {}),
            photoUrl: photo?.name
                ? `/api/discovery/photo?token=${encodeURIComponent(signPhoto(photo.name))}`
                : "",
            photoAttributions: (photo?.authorAttributions || []).map((a) => ({
                name: clean(a.displayName, 120),
                url: httpsUrl(a.uri),
            })),
            photoSource: httpsUrl(photo?.googleMapsUri) || httpsUrl(value.googleMapsUri),
            attributions: (value.attributions || []).map((a) => ({
                name: clean(a.provider, 120),
                url: httpsUrl(a.providerUri),
            })),
        };
    }
    function validateSearch(params) {
        const city = Core.text(params.get("city") || "", "City", 60);
        const category = params.get("category") || "All",
            q = Core.text(params.get("q") || "", "Search", 100, false);
        if (category !== "All" && !QUERIES[category]) throw error(400, "Choose a place category.");
        return { city, category, q };
    }
    async function places(params) {
        if (!key)
            throw error(
                503,
                "Live places are not connected yet. Add GOOGLE_PLACES_API_KEY to the planning server.",
            );
        const criteria = validateSearch(params),
            signature = JSON.stringify(criteria);
        for (const [id, session] of sessions) if (session.expires < now()) sessions.delete(id);
        let session,
            cursor = params.get("cursor");
        if (cursor) {
            session = sessions.get(cursor);
            if (!session || session.signature !== signature)
                throw error(410, "This search expired. Start a new search.");
            if (session.busy) throw error(409, "This search is still loading.");
        } else {
            if (sessions.size >= 500) throw error(429, "Discovery is busy. Try again shortly.");
            const entries =
                criteria.category === "All"
                    ? Object.entries(QUERIES)
                    : [[criteria.category, QUERIES[criteria.category]]];
            const jobs = criteria.q
                ? [{ category: criteria.category, query: criteria.q, page: 0 }]
                : entries.flatMap(([category, queries]) =>
                      queries.map((query) => ({ category, query, page: 0 })),
                  );
            cursor = crypto.randomBytes(20).toString("hex");
            session = { signature, jobs, seen: new Set(), expires: now() + 600000, busy: false };
            sessions.set(cursor, session);
        }
        session.busy = true;
        try {
            const jobs = session.jobs.slice(0, 3);
            const results = await Promise.allSettled(
                jobs.map((job) =>
                    json("https://places.googleapis.com/v1/places:searchText", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-Goog-Api-Key": key,
                            "X-Goog-FieldMask": FIELD_MASK,
                        },
                        body: JSON.stringify({
                            textQuery: `${job.query} in ${criteria.city}, India`,
                            pageSize: 20,
                            languageCode: "en",
                            regionCode: "IN",
                            ...(job.token ? { pageToken: job.token } : {}),
                        }),
                    }),
                ),
            );
            const found = [],
                warnings = [];
            results.forEach((result, index) => {
                const job = jobs[index];
                if (result.status === "rejected") {
                    warnings.push(result.reason.message);
                    return;
                }
                session.jobs.splice(session.jobs.indexOf(job), 1);
                for (const row of result.value.places || []) {
                    const place = googlePlace(row, criteria.city, job.category);
                    if (place && !session.seen.has(place.id)) {
                        session.seen.add(place.id);
                        found.push(place);
                    }
                }
                if (result.value.nextPageToken && job.page < 2)
                    session.jobs.push({
                        ...job,
                        token: result.value.nextPageToken,
                        page: job.page + 1,
                    });
            });
            if (results.every((result) => result.status === "rejected"))
                throw error(502, warnings[0]);
            session.expires = now() + 600000;
            const more = session.jobs.length > 0;
            if (!more) sessions.delete(cursor);
            return {
                places: found,
                cursor: more ? cursor : "",
                uniqueCount: session.seen.size,
                warnings: [...new Set(warnings)],
                provider: "Google Maps",
                notice: !session.seen.size
                    ? "This provider search returned no matches. Try a specific place or area; this does not establish that Goa or your selected city has no places."
                    : "Provider addresses and categories come from Google Maps. Durations, costs and travel remain planning choices; check the address before proposing a stop.",
            };
        } finally {
            session.busy = false;
        }
    }
    async function details(params) {
        if (!key) throw error(503, "Live places are not connected yet.");
        const id = params.get("id") || "",
            city = Core.text(params.get("city") || "", "City", 60);
        if (!/^google-[A-Za-z0-9_-]{1,80}$/.test(id))
            throw error(400, "Choose a valid Google place.");
        const category = QUERIES[params.get("category")] ? params.get("category") : "Sights";
        const value = await json(`https://places.googleapis.com/v1/places/${id.slice(7)}`, {
            headers: {
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask": FIELD_MASK.replaceAll("places.", "").replace(
                    ",nextPageToken",
                    "",
                ),
            },
        });
        return { place: googlePlace(value, city, category) };
    }
    async function photo(params) {
        if (!key) throw error(503, "Photos are not connected yet.");
        const token = params.get("token") || "";
        if (token.length > 7000) throw error(400, "Invalid photo reference.");
        const [value, signature, extra] = token.split(".");
        const expected = crypto
            .createHmac("sha256", secret)
            .update(value || "")
            .digest("base64url");
        if (
            extra ||
            !signature ||
            signature.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
            throw error(403, "Invalid photo reference.");
        let data;
        try {
            data = JSON.parse(Buffer.from(value, "base64url").toString());
        } catch {
            throw error(400, "Invalid photo reference.");
        }
        if (data.expires < now()) throw error(410, "This photo expired. Refresh the place search.");
        if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(data.resource))
            throw error(400, "Invalid photo resource.");
        const result = await json(
            `https://places.googleapis.com/v1/${data.resource}/media?maxWidthPx=800&skipHttpRedirect=true`,
            { headers: { "X-Goog-Api-Key": key } },
        );
        const uri = httpsUrl(result.photoUri);
        if (!uri || !new URL(uri).hostname.endsWith(".googleusercontent.com"))
            throw error(502, "The photo provider returned an unsupported image.");
        return uri;
    }
    function normalizeEvent(row, provider) {
        try {
            if (!row || !clean(row.id, 70)) return null;
            const eventDate = Core.date(row.date),
                eventEndDate = row.endDate ? Core.date(row.endDate) : eventDate;
            if (
                eventEndDate < eventDate ||
                ["cancelled", "canceled", "postponed"].includes(String(row.status).toLowerCase())
            )
                return null;
            const source = httpsUrl(row.ticketUrl);
            if (!source) return null;
            const eventTime = row.time ? clean(row.time, 5) : "";
            if (eventTime) Core.minutes(eventTime);
            return {
                ...Core.place({
                    id: `${provider}-${clean(row.id, 70)}`,
                    name: clean(row.name, 100),
                    city: clean(row.city, 60),
                    area: clean(row.venue, 100) || row.city,
                    category: "Event",
                    duration: 120,
                    description:
                        clean(row.description, 500) ||
                        "Check the organiser's listing for programme and ticket details.",
                    source,
                    custom: false,
                }),
                provider,
                eventDate,
                eventEndDate,
                ...(eventTime ? { eventTime } : {}),
                eventType: EVENT_TYPES.includes(row.type) ? row.type : "Other",
                imageUrl: httpsUrl(row.image),
                imageCredit: clean(row.imageCredit, 120) || provider,
            };
        } catch {
            return null;
        }
    }
    async function events(params) {
        if (!feed && !ticketKey)
            throw error(
                503,
                "Live events are not connected yet. Configure an authorised EVENTS_FEED_URL or TICKETMASTER_API_KEY on the server.",
            );
        const city = Core.text(params.get("city") || "", "City", 60),
            q = Core.text(params.get("q") || "", "Search", 100, false);
        const from = Core.date(params.get("from") || istDay(now())),
            to = Core.date(params.get("to") || from);
        if (to < from || (new Date(to) - new Date(from)) / 86400000 > 366)
            throw error(400, "Choose an event date range of up to one year.");
        const type = params.get("type") || "All";
        if (!EVENT_TYPES.includes(type)) throw error(400, "Choose an event type.");
        const page = Number(params.get("page") || 0);
        if (!Number.isInteger(page) || page < 0 || page > 49)
            throw error(400, "Choose a valid event page.");
        let rows, nextPage, provider;
        if (feed) {
            const url = new URL(feed);
            for (const [key, value] of Object.entries({ city, q, from, to, type, page, limit: 40 }))
                url.searchParams.set(key, String(value));
            const data = await json(url.href, {
                headers: {
                    ...(env.EVENTS_FEED_TOKEN
                        ? { Authorization: `Bearer ${env.EVENTS_FEED_TOKEN}` }
                        : {}),
                },
            });
            if (!Array.isArray(data.events))
                throw error(502, "The events feed must return an events array.");
            rows = data.events.slice(0, 200);
            nextPage = data.nextPage;
            provider = "feed";
        } else {
            const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
            // Query dates instead of startDateTime so multi-day ongoing events can
            // still be returned; local filtering below checks the actual range.
            const today = istDay(now());
            const classified = ["Music", "Comedy", "Theatre", "Sports"].includes(type);
            const utc = (day, clock) =>
                new Date(`${day}T${clock}+05:30`).toISOString().replace(".000Z", "Z");
            for (const [key, value] of Object.entries({
                apikey: ticketKey,
                city,
                countryCode: "IN",
                keyword: q || (type === "All" || classified ? "" : type),
                endDateTime: utc(to, "23:59:59"),
                sort: "date,asc",
                size: 40,
                page,
                includeTBA: "no",
                includeTBD: "no",
            }))
                url.searchParams.set(key, String(value));
            if (classified) url.searchParams.set("classificationName", type);
            url.searchParams.set(
                "startEndDateTime",
                `${utc(from < today ? today : from, "00:00:00")},${utc(to, "23:59:59")}`,
            );
            const data = await json(url.href);
            rows = (data._embedded?.events || []).map((event) => {
                const classification = (event.classifications || [])
                    .flatMap((c) => [c.segment?.name, c.genre?.name, c.subGenre?.name])
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                const eventType =
                    EVENT_TYPES.slice(1, -1).find((t) =>
                        classification.includes(t.toLowerCase()),
                    ) || "Other";
                return {
                    id: event.id,
                    name: event.name,
                    city: event._embedded?.venues?.[0]?.city?.name || city,
                    venue: event._embedded?.venues?.[0]?.name,
                    date: event.dates?.start?.localDate,
                    time: event.dates?.start?.localTime,
                    endDate: event.dates?.end?.localDate,
                    status: event.dates?.status?.code,
                    ticketUrl: event.url,
                    image: event.images?.find((i) => i.ratio === "16_9" && i.width >= 500)?.url,
                    imageCredit: "Ticketmaster / event organiser",
                    type: eventType,
                    description: [
                        event.info,
                        ...(event._embedded?.attractions || []).map((a) => a.name),
                    ]
                        .filter(Boolean)
                        .join(" · "),
                };
            });
            nextPage = page + 1 < (data.page?.totalPages || 0) ? page + 1 : null;
            provider = "ticketmaster";
        }
        const seen = new Set();
        const found = rows
            .map((row) => normalizeEvent(row, provider))
            .filter((event) => {
                if (
                    !event ||
                    event.city.toLowerCase() !== city.toLowerCase() ||
                    event.eventDate > to ||
                    event.eventEndDate < from ||
                    event.eventEndDate < istDay(now()) ||
                    (type !== "All" && event.eventType !== type) ||
                    (q &&
                        !`${event.name} ${event.area} ${event.description} ${event.eventType}`
                            .toLowerCase()
                            .includes(q.toLowerCase())) ||
                    seen.has(event.id)
                )
                    return false;
                seen.add(event.id);
                return true;
            });
        return {
            events: found,
            nextPage:
                Number.isInteger(nextPage) && nextPage > page && nextPage < 50 ? nextPage : null,
            provider: feed ? "City events feed" : "Ticketmaster",
            notice: feed
                ? "Listings from the connected city events feed."
                : "Ticketmaster coverage varies by city; an empty result does not mean there are no events.",
        };
    }
    return { config, places, details, photo, events };
}
module.exports = { createDiscovery, QUERIES, EVENT_TYPES };
