/* Offline backups: stop the server first. Restore into a new directory, never over live data. */
"use strict";
const fs = require("node:fs"),
    path = require("node:path"),
    crypto = require("node:crypto"),
    { DatabaseSync } = require("node:sqlite");
const checksum = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function copyMedia(db, source, target) {
    const copied = [];
    for (const row of db.prepare("SELECT code,record FROM groups").all()) {
        if (!/^[A-Za-z0-9_-]{16}$/.test(row.code))
            throw new Error("Invalid trip reference in backup.");
        for (const photo of JSON.parse(row.record).state.scrapbook || []) {
            if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(photo.id))
                throw new Error("Invalid media reference in backup.");
            const relative = path.join("media", row.code, photo.id),
                from = path.join(source, relative),
                to = path.join(target, relative);
            if (!fs.existsSync(from)) throw new Error("A referenced photo is missing: " + relative);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
            copied.push({ path: relative, sha256: checksum(to) });
        }
    }
    return copied;
}
function backup(source, target) {
    source = path.resolve(source);
    target = path.resolve(target);
    if (fs.existsSync(target)) throw new Error("Choose a new, empty backup path.");
    if (target === source || target.startsWith(source + path.sep))
        throw new Error("Keep backups outside the active data directory.");
    const db = new DatabaseSync(path.join(source, "plans.sqlite"), { readOnly: true });
    try {
        fs.mkdirSync(target, { recursive: true });
        db.prepare("VACUUM INTO ?").run(path.join(target, "plans.sqlite"));
        const snapshot = new DatabaseSync(path.join(target, "plans.sqlite"), { readOnly: true });
        let media;
        try {
            media = copyMedia(snapshot, source, target);
        } finally {
            snapshot.close();
        }
        fs.writeFileSync(
            path.join(target, "manifest.json"),
            JSON.stringify(
                {
                    version: 1,
                    createdAt: new Date().toISOString(),
                    database: checksum(path.join(target, "plans.sqlite")),
                    media,
                },
                null,
                2,
            ),
            { mode: 0o600 },
        );
    } finally {
        db.close();
    }
}
function restore(source, target) {
    source = path.resolve(source);
    target = path.resolve(target);
    if (fs.existsSync(target))
        throw new Error("Restore into a new directory. The current data will remain untouched.");
    const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
    if (manifest.version !== 1 || checksum(path.join(source, "plans.sqlite")) !== manifest.database)
        throw new Error("Backup manifest or database checksum is invalid.");
    for (const p of manifest.media) {
        if (
            !/^media[\\/][A-Za-z0-9_-]{16}[\\/][0-9a-f-]{36}\.(jpg|png)$/.test(p.path) ||
            checksum(path.join(source, p.path)) !== p.sha256
        )
            throw new Error("Backup photo checksum is invalid.");
    }
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(
        path.join(source, "plans.sqlite"),
        path.join(target, "plans.sqlite"),
        fs.constants.COPYFILE_EXCL,
    );
    const db = new DatabaseSync(path.join(target, "plans.sqlite"));
    try {
        copyMedia(db, source, target);
        db.exec("DELETE FROM sessions; DELETE FROM challenges;");
        if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
            throw new Error("Database integrity check failed.");
    } finally {
        db.close();
    }
}
if (require.main === module) {
    try {
        const [action, source, target] = process.argv.slice(2);
        if (!["backup", "restore"].includes(action) || !source || !target)
            throw new Error(
                "Usage: node scripts/backup.js backup|restore source-directory new-target-directory (server must be stopped)",
            );
        ({ backup, restore })[action](source, target);
        console.log("Completed " + action + " into " + path.resolve(target));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}
module.exports = { backup, restore };
