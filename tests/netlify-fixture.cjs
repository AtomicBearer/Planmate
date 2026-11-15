"use strict";
const { createNetlifyApi } = require("../server/netlify-api");
const { createDiscovery } = require("../server/services/discovery");
const { createMapService } = require("../server/services/map-service");
function createBlobs() {
    const records = new Map();
    let sequence = 0;
    return {
        async getWithMetadata(key) {
            return structuredClone(records.get(key) || null);
        },
        async get(key) {
            return structuredClone(records.get(key)?.data ?? null);
        },
        async setJSON(key, data, options = {}) {
            const previous = records.get(key);
            if (
                (options.onlyIfNew && previous) ||
                (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch)
            )
                return { modified: false };
            const etag = String(++sequence);
            records.set(key, {
                data: structuredClone(data),
                etag,
                metadata: options.metadata || {},
            });
            return { modified: true, etag };
        },
        async set(key, data, options) {
            return this.setJSON(key, data, options);
        },
        async delete(key) {
            records.delete(key);
        },
    };
}
function fixture() {
    const store = createBlobs(),
        media = createBlobs();
    const handler = () =>
        createNetlifyApi({
            store,
            media,
            discovery: createDiscovery({ env: {} }),
            maps: createMapService({ env: {} }),
        });
    const call = async (path, value, token, extraHeaders = {}) => {
        const response = await handler()(
            new Request("https://planmate.test" + path, {
                method: value === undefined ? "GET" : "POST",
                headers: {
                    "Content-Type": "application/json",
                    Origin: "https://planmate.test",
                    ...(token ? { Authorization: "Bearer " + token } : {}),
                    ...extraHeaders,
                },
                ...(value === undefined ? {} : { body: JSON.stringify(value) }),
            }),
        );
        return { status: response.status, data: await response.json() };
    };
    return { store, media, handler, call };
}
module.exports = { fixture, createBlobs };
