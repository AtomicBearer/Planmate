/* SQLite transactions own shared revisions. JSON is imported once and preserved. */
"use strict";
const fs = require("node:fs"),
    path = require("node:path"),
    { DatabaseSync } = require("node:sqlite"),
    Core = require("./planner-core");
function conflict() {
    const e = new Error("The plan changed. Refresh it before saving.");
    e.status = 409;
    throw e;
}
function createPlanStore({ file = null, legacyFile = null } = {}) {
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file || ":memory:");
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > 1) {
        db.close();
        throw new Error("Database is newer than this server. Restore a compatible release.");
    }
    function transaction(fn) {
        db.exec("BEGIN IMMEDIATE");
        try {
            const result = fn();
            db.exec("COMMIT");
            return result;
        } catch (e) {
            db.exec("ROLLBACK");
            throw e;
        }
    }
    if (version < 1)
        transaction(() =>
            db.exec(`
        CREATE TABLE groups(code TEXT PRIMARY KEY, revision INTEGER NOT NULL, record TEXT NOT NULL);
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE accounts(id TEXT PRIMARY KEY, subject TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, profile TEXT NOT NULL, profile_revision INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE sessions(hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE challenges(hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
        PRAGMA user_version=1;
    `),
        );
    if (
        legacyFile &&
        fs.existsSync(legacyFile) &&
        !db.prepare("SELECT value FROM metadata WHERE key='json-import'").get()
    ) {
        try {
            const source = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
            if (source.version !== 1 || !source.groups || Array.isArray(source.groups))
                throw new Error("Unsupported legacy plans. The original JSON has been preserved.");
            const backup = legacyFile + ".pre-sqlite.backup";
            if (!fs.existsSync(backup))
                fs.copyFileSync(legacyFile, backup, fs.constants.COPYFILE_EXCL);
            transaction(() => {
                const insert = db.prepare("INSERT OR IGNORE INTO groups VALUES(?,?,?)");
                for (const [code, original] of Object.entries(source.groups)) {
                    if (!/^[A-Za-z0-9_-]{16}$/.test(code))
                        throw new Error("Invalid legacy trip code.");
                    const record = { ...original, state: Core.migrate(original.state) };
                    insert.run(code, record.state.revision, JSON.stringify(record));
                }
                db.prepare("INSERT OR IGNORE INTO metadata VALUES('json-import',?)").run(
                    new Date().toISOString(),
                );
            });
        } catch (e) {
            db.close();
            throw e;
        }
    }
    function snapshot() {
        return {
            version: 1,
            groups: Object.fromEntries(
                db
                    .prepare("SELECT code,record FROM groups")
                    .all()
                    .map((r) => [r.code, JSON.parse(r.record)]),
            ),
        };
    }
    function commit(before, next) {
        transaction(() => {
            for (const [code, value] of Object.entries(next.groups)) {
                if (JSON.stringify(value) === JSON.stringify(before.groups[code])) continue;
                const current = db.prepare("SELECT revision FROM groups WHERE code=?").get(code);
                if (
                    before.groups[code]
                        ? !current || current.revision !== before.groups[code].state.revision
                        : current
                )
                    conflict();
                db.prepare(
                    "INSERT INTO groups VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET revision=excluded.revision,record=excluded.record",
                ).run(code, value.state.revision, JSON.stringify(value));
            }
        });
        return snapshot();
    }
    return {
        db,
        transaction,
        snapshot,
        commit,
        close: () => db.close(),
        backup(target) {
            db.prepare("VACUUM INTO ?").run(target);
        },
    };
}
module.exports = { createPlanStore };
