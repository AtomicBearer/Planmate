import { getStore } from "@netlify/blobs";

// Only expired provider references. Never delete memberships, trips or own photos.
export default async () => {
    const store = getStore({ name: "planmate-production-references", consistency: "strong" });
    const cutoff = Date.now() - 60 * 60 * 1000;
    let checked = 0;
    for (const prefix of ["search/", "map/"]) {
        for await (const page of store.list({ prefix, paginate: true })) {
            for (const blob of page.blobs) {
                if (++checked > 500) return new Response(null, { status: 204 });
                const record = await store.getMetadata(blob.key);
                if (Number.isFinite(record?.metadata?.expires) && record.metadata.expires < cutoff)
                    await store.delete(blob.key);
            }
        }
    }
    return new Response(null, { status: 204 });
};
export const config = { schedule: "15 * * * *" };
