/* Starter discovery catalogue. No invented prices, ratings, opening hours or live events. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.PlannerCatalogue = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const guide = "https://www.incredibleindia.gov.in/en/attractions";
    const destinations = {
        Goa: [
            ["Baga Beach", "Beach", "Baga", 120, "https://goa-tourism.com/beach/baga/"],
            ["Artjuna Café", "Food", "Anjuna", 90, "https://www.artjuna.com/"],
            [
                "Fontainhas",
                "Sights",
                "Panaji",
                90,
                "https://goa-tourism.com/popular-destination/experience-fontainhas/",
            ],
            ["Club Tito’s", "Nightlife", "Baga", 180, "https://titos.in/"],
            ["Palolem Beach", "Beach", "Canacona", 150],
            ["Gunpowder", "Food", "Assagao", 90, "https://gunpowder.co.in/"],
            ["Fort Aguada", "Sights", "Candolim", 90],
            ["Café Mambo", "Nightlife", "Baga", 180, "https://titos.in/"],
            ["Anjuna Beach", "Beach", "Anjuna", 120],
            ["Vagator Beach", "Beach", "Vagator", 120],
            ["Dudhsagar Falls", "Outdoors", "Goa", 240],
            ["Basilica of Bom Jesus", "Sights", "Old Goa", 60],
        ],
        Mumbai: [
            ["Marine Drive", "Outdoors"],
            ["Gateway of India", "Sights"],
            ["Sanjay Gandhi National Park", "Outdoors"],
            ["Juhu Beach", "Beach"],
        ],
        Delhi: [
            ["India Gate", "Sights"],
            ["Humayun’s Tomb", "Sights"],
            ["Lodhi Garden", "Outdoors"],
            ["Dilli Haat", "Sights"],
        ],
        Bengaluru: [
            ["Cubbon Park", "Outdoors"],
            ["Bangalore Palace", "Sights"],
            ["Lalbagh Botanical Garden", "Outdoors"],
            ["Tipu Sultan’s Summer Palace", "Sights"],
        ],
        Pune: [
            ["Shaniwar Wada", "Sights"],
            ["Aga Khan Palace", "Sights"],
            ["Sinhagad Fort", "Outdoors"],
        ],
        Hyderabad: [
            ["Charminar", "Sights"],
            ["Golconda Fort", "Sights"],
            ["Hussain Sagar", "Outdoors"],
            ["Salar Jung Museum", "Sights"],
        ],
        Chennai: [
            ["Marina Beach", "Beach"],
            ["Government Museum", "Sights"],
            ["Elliot’s Beach", "Beach"],
        ],
        Kolkata: [
            ["Victoria Memorial", "Sights"],
            ["Indian Museum", "Sights"],
            ["Prinsep Ghat", "Outdoors"],
        ],
        Jaipur: [
            ["Hawa Mahal", "Sights"],
            ["Amber Fort", "Sights"],
            ["City Palace", "Sights"],
            ["Jantar Mantar", "Sights"],
        ],
        Ahmedabad: [
            ["Sabarmati Ashram", "Sights"],
            ["Kankaria Lake", "Outdoors"],
            ["Adalaj Stepwell", "Sights"],
        ],
        Kochi: [
            ["Fort Kochi", "Sights"],
            ["Mattancherry Palace", "Sights"],
            ["Cherai Beach", "Beach"],
        ],
        Udaipur: [
            ["City Palace", "Sights"],
            ["Lake Pichola", "Outdoors"],
            ["Saheliyon Ki Bari", "Outdoors"],
        ],
        Agra: [
            ["Taj Mahal", "Sights"],
            ["Agra Fort", "Sights"],
            ["Mehtab Bagh", "Outdoors"],
        ],
        Amritsar: [
            ["Golden Temple", "Sights"],
            ["Partition Museum", "Sights"],
            ["Jallianwala Bagh", "Sights"],
        ],
        Varanasi: [
            ["Assi Ghat", "Sights"],
            ["Dashashwamedh Ghat", "Sights"],
            ["Sarnath", "Sights"],
        ],
        Lucknow: [
            ["Bara Imambara", "Sights"],
            ["Rumi Darwaza", "Sights"],
            ["British Residency", "Sights"],
        ],
        Chandigarh: [
            ["Rock Garden", "Sights"],
            ["Sukhna Lake", "Outdoors"],
            ["Zakir Hussain Rose Garden", "Outdoors"],
        ],
        Indore: [
            ["Rajwada Palace", "Sights"],
            ["Lal Bagh Palace", "Sights"],
            ["Sarafa Bazaar", "Food"],
        ],
        Mysuru: [
            ["Mysore Palace", "Sights"],
            ["Brindavan Gardens", "Outdoors"],
            ["Chamundi Hills", "Outdoors"],
        ],
        Shimla: [
            ["The Ridge", "Outdoors"],
            ["Jakhu Temple", "Sights"],
            ["Viceregal Lodge", "Sights"],
        ],
        Rishikesh: [
            ["Triveni Ghat", "Sights"],
            ["The Beatles Ashram", "Sights"],
            ["Ram Jhula", "Sights"],
        ],
        Manali: [
            ["Hadimba Devi Temple", "Sights"],
            ["Solang Valley", "Outdoors"],
            ["Manu Temple", "Sights"],
        ],
        Srinagar: [
            ["Dal Lake", "Outdoors"],
            ["Shalimar Bagh", "Outdoors"],
            ["Mughal Gardens", "Outdoors"],
        ],
        Surat: [
            ["Dumas Beach", "Beach"],
            ["Surat Castle", "Sights"],
            ["Dutch Garden", "Outdoors"],
        ],
        Nagpur: [
            ["Deekshabhoomi", "Sights"],
            ["Futala Lake", "Outdoors"],
            ["Raman Science Centre", "Sights"],
        ],
        Bhopal: [
            ["Upper Lake", "Outdoors"],
            ["Bharat Bhavan", "Sights"],
            ["Van Vihar National Park", "Outdoors"],
        ],
        Bhubaneswar: [
            ["Lingaraj Temple", "Sights"],
            ["Udayagiri and Khandagiri Caves", "Sights"],
            ["Odisha State Museum", "Sights"],
        ],
        Visakhapatnam: [
            ["Ramakrishna Beach", "Beach"],
            ["Kailasagiri", "Outdoors"],
            ["INS Kurusura Submarine Museum", "Sights"],
        ],
        Guwahati: [
            ["Kamakhya Temple", "Sights"],
            ["Assam State Museum", "Sights"],
            ["Umananda Temple", "Sights"],
        ],
        Puducherry: [
            ["Promenade Beach", "Beach"],
            ["White Town", "Sights"],
            ["Bharathi Park", "Outdoors"],
        ],
        Thiruvananthapuram: [
            ["Kovalam Beach", "Beach"],
            ["Napier Museum", "Sights"],
            ["Shanghumukham Beach", "Beach"],
        ],
        Madurai: [
            ["Meenakshi Amman Temple", "Sights"],
            ["Thirumalai Nayakkar Mahal", "Sights"],
            ["Gandhi Memorial Museum", "Sights"],
        ],
    };
    const descriptions = {
        Beach: "A little sea breeze, a long walk, and time to slow down together.",
        Food: "Make room for a shared meal and an unhurried catch-up.",
        Nightlife:
            "A night out for the group. Check the venue’s current programme, entry rules and booking details.",
        Sights: "Add a little local history, culture, and exploring to your day.",
        Outdoors: "Step outside and leave some space for exploring at your own pace.",
    };
    const places = Object.entries(destinations).flatMap(([city, rows]) =>
        rows.map(([name, category, area, duration, source], i) => ({
            id: `${city.toLowerCase().replace(/\s/g, "-")}-${i}`,
            name,
            category,
            city,
            area: area || city,
            duration: duration || (category === "Outdoors" ? 120 : 90),
            description: descriptions[category],
            source:
                source || (city === "Goa" ? "https://www.incredibleindia.gov.in/en/goa" : guide),
            custom: false,
        })),
    );
    return { cities: Object.keys(destinations), places };
});
