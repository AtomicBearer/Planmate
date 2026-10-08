/* Private profile validation shared by server and browser. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.PlanmateProfileRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const hobbies = [
        "Photography",
        "Music",
        "Hiking",
        "Food hunting",
        "Reading",
        "Dancing",
        "Art",
        "Gaming",
        "Cycling",
        "Water sports",
        "History",
        "Shopping",
    ];
    const places = [
        { id: "beaches", name: "Beaches & coasts", note: "Salt air, slow sunsets", icon: "beach" },
        {
            id: "food",
            name: "Cafés & restaurants",
            note: "Good coffee, better company",
            icon: "food",
        },
        {
            id: "nightlife",
            name: "Clubs & nightlife",
            note: "A little dancing after dark",
            icon: "music",
        },
        {
            id: "heritage",
            name: "Art & heritage",
            note: "Stories around every corner",
            icon: "sights",
        },
        { id: "nature", name: "Parks & nature", note: "A breath of fresh air", icon: "leaf" },
        {
            id: "events",
            name: "Concerts & events",
            note: "Be there for the moment",
            icon: "calendar",
        },
        { id: "adventure", name: "Adventure & trails", note: "Take the scenic way", icon: "route" },
        { id: "markets", name: "Local markets", note: "Little finds, local flavours", icon: "bag" },
    ];
    const options = {
        pace: {
            relaxed: "Slow & easy",
            balanced: "A little of everything",
            packed: "Make the most of every day",
        },
        budget: {
            budget: "Budget friendly",
            flexible: "A little save, a little splurge",
            comfort: "Comfort comes first",
        },
        company: {
            friends: "My friends",
            family: "Family",
            partner: "My partner",
            solo: "A solo adventure",
            mixed: "Depends on the trip",
        },
        time: {
            early: "Early mornings",
            late: "Late nights",
            flexible: "Whenever the plan feels right",
        },
    };
    const colours = ["terracotta", "sage", "sand", "sky", "rose"];
    function short(value, max, fallback = "") {
        return typeof value === "string" ? value.trim().slice(0, max) : fallback;
    }
    function unique(values, maxLength, limit) {
        return [
            ...new Set(
                (Array.isArray(values) ? values : [])
                    .map((v) => short(v, maxLength))
                    .filter(Boolean),
            ),
        ].slice(0, limit);
    }
    function normalise(value, fallbackName = "You") {
        const source = value && typeof value === "object" ? value : {};
        const user = { name: fallbackName };
        const wishes = [],
            seen = new Set();
        for (const item of Array.isArray(source.wishlist) ? source.wishlist : []) {
            const city = short(item?.city, 60);
            if (!city || seen.has(city.toLocaleLowerCase())) continue;
            seen.add(city.toLocaleLowerCase());
            wishes.push({
                id: short(item.id, 100) || `wish-${wishes.length}`,
                city,
                priority: ["someday", "soon", "this-year"].includes(item.priority)
                    ? item.priority
                    : "someday",
                month:
                    typeof item.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)
                        ? item.month
                        : "",
                note: short(item.note, 200),
                visited: item.visited === true,
            });
            if (wishes.length === 50) break;
        }
        return {
            version: 1,
            name: short(source.name, 60) || short(user.name, 60) || short(fallbackName, 60, "You"),
            bio: short(source.bio, 300),
            homeCity: short(source.homeCity, 60),
            hobbies: unique(source.hobbies, 35, 20),
            placeTypes: unique(source.placeTypes, 40, 8).filter((id) =>
                places.some((p) => p.id === id),
            ),
            pace: Object.hasOwn(options.pace, source.pace) ? source.pace : "balanced",
            budget: Object.hasOwn(options.budget, source.budget) ? source.budget : "flexible",
            company: Object.hasOwn(options.company, source.company) ? source.company : "friends",
            time: Object.hasOwn(options.time, source.time) ? source.time : "flexible",
            colour: colours.includes(source.colour) ? source.colour : "terracotta",
            wishlist: wishes,
            updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
        };
    }

    return { hobbies, places, options, colours, normalise };
});
