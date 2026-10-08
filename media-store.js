/* Own trip photos only. Provider photos never enter this store. */
"use strict";
const fs = require("node:fs"),
    path = require("node:path"),
    crypto = require("node:crypto");
const LIMIT = 5 * 1024 * 1024;
const sharp = require("sharp");
async function processImage(bytes, type) {
    validateImage(bytes, type);
    try {
        const input = sharp(bytes, {
            limitInputPixels: 40000000,
            failOn: "warning",
            animated: false,
        });
        const info = await input.metadata();
        if (
            !["jpeg", "png"].includes(info.format) ||
            `image/${info.format}` !== type ||
            (info.pages || 1) !== 1
        )
            throw new Error("Invalid image format.");
        const output = await (
            info.format === "jpeg"
                ? input.rotate().jpeg({ quality: 90 })
                : input.rotate().png({ compressionLevel: 9 })
        ).toBuffer();
        return { bytes: output, details: validateImage(output, type) };
    } catch {
        throw new Error(
            "This photo cannot be decoded safely. Choose a valid, single-frame JPEG or PNG.",
        );
    }
}
function validateImage(bytes, type) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT)
        throw new Error("Choose a JPEG or PNG photo up to 5 MB.");
    let width, height, extension;
    if (
        type === "image/png" &&
        bytes.length >= 45 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR"
    ) {
        width = bytes.readUInt32BE(16);
        height = bytes.readUInt32BE(20);
        extension = "png";
        let offset = 8,
            ended = false;
        while (offset + 12 <= bytes.length) {
            const length = bytes.readUInt32BE(offset);
            if (offset + length + 12 > bytes.length) throw new Error("PNG file is incomplete.");
            const chunk = bytes.toString("ascii", offset + 4, offset + 8);
            offset += length + 12;
            if (chunk === "IEND") {
                ended = true;
                break;
            }
        }
        if (!ended) throw new Error("PNG file is incomplete.");
    } else if (
        type === "image/jpeg" &&
        bytes.length >= 12 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[bytes.length - 2] === 255 &&
        bytes[bytes.length - 1] === 217
    ) {
        extension = "jpg";
        let offset = 2;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset] !== 255) break;
            while (bytes[offset] === 255) offset++;
            const marker = bytes[offset++];
            if (marker === 217 || marker === 218) break;
            if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
            const length = bytes.readUInt16BE(offset);
            if (length < 2 || offset + length > bytes.length)
                throw new Error("JPEG file is incomplete.");
            if ([192, 193, 194].includes(marker) && length >= 8) {
                height = bytes.readUInt16BE(offset + 3);
                width = bytes.readUInt16BE(offset + 5);
                break;
            }
            offset += length;
        }
    }
    if (
        !extension ||
        !width ||
        !height ||
        width > 12000 ||
        height > 12000 ||
        width * height > 40000000
    )
        throw new Error(
            "Use a valid JPEG or PNG photo, no larger than 40 megapixels or 12,000 pixels per side.",
        );
    return { type, extension, width, height, size: bytes.length };
}
function createMediaStore(directory) {
    const memory = new Map();
    function file(group, id) {
        if (!/^[A-Za-z0-9_-]{16}$/.test(group) || !/^[0-9a-f-]{36}\.(jpg|png)$/.test(id))
            throw new Error("Invalid photo reference.");
        return directory ? path.join(directory, group, id) : null;
    }
    async function write(group, bytes, type) {
        const processed = await processImage(bytes, type);
        bytes = processed.bytes;
        const details = processed.details,
            id = `${crypto.randomUUID()}.${details.extension}`,
            target = file(group, id);
        if (target) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
        } else memory.set(`${group}/${id}`, Buffer.from(bytes));
        return { id, ...details };
    }
    function read(group, id) {
        const target = file(group, id);
        const bytes = target ? fs.readFileSync(target) : memory.get(`${group}/${id}`);
        if (!bytes) throw Object.assign(new Error("Photo file unavailable."), { code: "ENOENT" });
        return bytes;
    }
    function remove(group, id) {
        const target = file(group, id);
        if (target) {
            try {
                fs.unlinkSync(target);
            } catch (e) {
                if (e.code !== "ENOENT") throw e;
            }
        } else memory.delete(`${group}/${id}`);
    }
    return { write, read, remove };
}
module.exports = { LIMIT, validateImage, processImage, createMediaStore };
