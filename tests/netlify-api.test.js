"use strict";
const { test } = require("node:test"),
    assert = require("node:assert/strict");
const { fixture, createBlobs } = require("./netlify-fixture.cjs");
const { discoverySessions, signingSecret } = require("../server/netlify-cache");
const { createDiscovery } = require("../server/services/discovery");
const sharp = require("sharp");
const trip = {
    title: "Three explorers",
    city: "Chikkamagaluru",
    start: "2027-01-16",
    end: "2027-01-19",
    budget: 8000,
};
test("three independent browsers join, persist changes across handlers, reject outsiders and stale writes", async () => {
    const { call } = fixture();
    const owner = (await call("/api/groups", { name: "Owner", trip })).data;
    const path = "/api/groups/" + owner.code;
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path + "/join", { name: "Stranger", invite: "bad" })).status, 403);
    const friend1 = await call(path + "/join", { name: "Friend one", invite: owner.invite });
    const friend2 = await call(path + "/join", { name: "Friend two", invite: owner.invite });
    assert.equal(friend1.status, 201);
    assert.equal(friend2.status, 201);
    const before = (await call(path, undefined, owner.token)).data.state;
    assert.equal(before.members.length, 3);
    assert.deepEqual(before.stops, []);
    const changes = await Promise.all(
        [owner, friend1.data].map((m, i) =>
            call(
                path + "/commands",
                {
                    type: "updateMember",
                    payload: { name: "Renamed " + i },
                    revision: before.revision,
                },
                m.token,
            ),
        ),
    );
    assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
    let state = (await call(path, undefined, friend2.data.token)).data.state;
    const journey = {
        id: "outbound",
        from: "Mumbai",
        to: "Birur (RRB)",
        departureDate: "2027-01-15",
        arrivalDate: "2027-01-16",
        departureTime: "",
        arrivalTime: "",
    };
    const saved = await call(
        path + "/commands",
        { type: "addJourney", payload: journey, revision: state.revision },
        friend2.data.token,
    );
    assert.equal(saved.status, 200);
    state = saved.data.state;
    assert.equal(
        (await call(path, undefined, owner.token)).data.state.journeys[0].by,
        friend2.data.memberId,
    );
    assert.equal(
        (
            await call(
                path + "/invite",
                { action: "rotate", revision: state.revision },
                friend1.data.token,
            )
        ).status,
        403,
    );
    assert.equal(
        (await call(path + "/invite", { action: "revoke", revision: state.revision }, owner.token))
            .status,
        200,
    );
    assert.equal((await call(path + "/join", { name: "Extra", invite: owner.invite })).status, 403);
    state = (await call(path, undefined, owner.token)).data.state;
    assert.equal(
        (
            await call(
                path + "/commands",
                {
                    type: "removeMember",
                    payload: { memberId: friend1.data.memberId },
                    revision: state.revision,
                },
                owner.token,
            )
        ).status,
        200,
    );
    assert.equal((await call(path, undefined, friend1.data.token)).status, 401);
    assert.equal(
        (
            await call("/api/groups", { name: "Other", trip }, undefined, {
                Origin: "https://evil.test",
            })
        ).status,
        403,
    );
});
test("expired invitations and malformed / oversized requests are rejected", async () => {
    const f = fixture(),
        owner = (await f.call("/api/groups", { trip, name: "Owner" })).data;
    const key = "trips/" + owner.code,
        entry = await f.store.getWithMetadata(key);
    entry.data.invite.expires = 0;
    await f.store.setJSON(key, entry.data, { onlyIfMatch: entry.etag });
    assert.equal(
        (
            await f.call("/api/groups/" + owner.code + "/join", {
                name: "Late",
                invite: owner.invite,
            })
        ).status,
        403,
    );
    assert.equal((await f.call("/api/groups", { trip, name: "x".repeat(300000) })).status, 413);
    assert.equal(
        (
            await f.call("/api/groups", { trip, name: "Owner" }, null, {
                "Content-Type": "text/plain",
            })
        ).status,
        415,
    );
});

test("Netlify photos require membership, remain private and enforce author deletion", async () => {
    const f = fixture(),
        owner = (await f.call("/api/groups", { trip, name: "Owner" })).data;
    const path = "/api/groups/" + owner.code;
    const friend = (await f.call(path + "/join", { name: "Friend", invite: owner.invite })).data;
    const entry = await f.store.getWithMetadata("trips/" + owner.code);
    entry.data.state.stops.push({
        id: "stop",
        date: trip.start,
        start: "10:00",
        end: "11:00",
        travel: 0,
        cost: 0,
        place: require("../shared/chikkamagaluru").places[0],
    });
    entry.data.state.visits.stop = { by: owner.memberId, at: new Date().toISOString() };
    await f.store.setJSON("trips/" + owner.code, entry.data, { onlyIfMatch: entry.etag });
    const image = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "#99aa77" },
    })
        .png()
        .toBuffer();
    const upload = (token) =>
        f.handler()(
            new Request(
                "https://planmate.test" +
                    path +
                    "/photos?stopId=stop&revision=1&caption=Our%20trip",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "image/png",
                        ...(token ? { Authorization: "Bearer " + token } : {}),
                    },
                    body: image,
                },
            ),
        );
    assert.equal((await upload()).status, 401);
    const response = await upload(owner.token);
    assert.equal(response.status, 201);
    const state = (await response.json()).state,
        record = state.scrapbook[0];
    assert.equal(record.by, owner.memberId);
    assert.equal(record.caption, "Our trip");
    assert.equal(record.width, 2);
    const photo = path + "/photos/" + record.id;
    assert.equal((await f.call(photo)).status, 401);
    const download = await f.handler()(
        new Request("https://planmate.test" + photo, {
            headers: { Authorization: "Bearer " + friend.token },
        }),
    );
    assert.equal(download.status, 200);
    assert.match(download.headers.get("cache-control"), /private, no-store/);
    assert.equal(download.headers.get("content-type"), "image/png");
    assert.equal(
        (
            await f.call(
                path + "/commands",
                { type: "deletePhoto", payload: { id: record.id }, revision: state.revision },
                friend.token,
            )
        ).status,
        400,
    );
    assert.equal(
        (
            await f.call(
                path + "/commands",
                { type: "deletePhoto", payload: { id: record.id }, revision: state.revision },
                owner.token,
            )
        ).status,
        200,
    );
    assert.equal((await f.call(photo, undefined, friend.token)).status, 404);
    assert.equal(await f.media.get(owner.code + "/" + record.id), null);
});
test("provider pagination and photo signatures survive separate serverless instances", async () => {
    const store = createBlobs();
    const [one, two] = await Promise.all([signingSecret(store), signingSecret(store)]);
    assert.equal(one, two);
    let number = 0;
    const options = {
        env: { GOOGLE_PLACES_API_KEY: "test-only" },
        signingSecret: one,
        fetchImpl: async (url) =>
            new Response(
                JSON.stringify(
                    String(url).includes("/media")
                        ? { photoUri: "https://lh3.googleusercontent.com/test-photo" }
                        : {
                              places: [
                                  {
                                      id: "place" + ++number,
                                      displayName: { text: "Actual place" },
                                      photos: [
                                          {
                                              name: "places/place1/photos/photo1",
                                              authorAttributions: [],
                                          },
                                      ],
                                  },
                              ],
                              nextPageToken: "next",
                          },
                ),
                { headers: { "Content-Type": "application/json" } },
            ),
    };
    const params = new URLSearchParams({ city: "Chikkamagaluru", category: "Outdoors" });
    const first = await createDiscovery({
        ...options,
        sessionStore: discoverySessions(store),
    }).places(params);
    assert.ok(first.cursor);
    params.set("cursor", first.cursor);
    const secondService = createDiscovery({ ...options, sessionStore: discoverySessions(store) });
    const second = await secondService.places(params);
    assert.ok(second.uniqueCount > first.uniqueCount);
    const photo = new URL(first.places[0].photoUrl, "https://planmate.test");
    assert.equal(
        await secondService.photo(photo.searchParams),
        "https://lh3.googleusercontent.com/test-photo",
    );
});
