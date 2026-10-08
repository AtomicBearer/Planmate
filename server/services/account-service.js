/* Verified Google identity, expiring server sessions and private account profiles. */
"use strict";
const crypto = require("node:crypto"),
    { OAuth2Client } = require("google-auth-library");
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex"),
    random = () => crypto.randomBytes(32).toString("base64url");
function fail(status, message) {
    const e = new Error(message);
    e.status = status;
    throw e;
}
function cookie(req, name) {
    return (
        req.headers.cookie
            ?.split(";")
            .map((v) => v.trim().split("="))
            .find((v) => v[0] === name)?.[1] || ""
    );
}
function createAccounts(store, { env = process.env, verify, now = Date.now } = {}) {
    const clientId = env.GOOGLE_CLIENT_ID || "",
        configured = Boolean(clientId),
        required = env.ACCOUNT_MODE === "required",
        secure = env.SESSION_SECURE === "true";
    if (required && !configured)
        throw new Error(
            "ACCOUNT_MODE=required needs GOOGLE_CLIENT_ID. Guest access is disabled in required mode.",
        );
    const client = new OAuth2Client(clientId),
        publicOrigin = env.PUBLIC_ORIGIN || "",
        db = store.db;
    if (required && publicOrigin && !/^https:\/\//.test(publicOrigin))
        throw new Error("Public account deployments require an HTTPS PUBLIC_ORIGIN.");
    if (required && publicOrigin && !secure)
        throw new Error("Public account deployments require SESSION_SECURE=true.");
    const verifyToken =
        verify ||
        (async (credential) =>
            (await client.verifyIdToken({ idToken: credential, audience: clientId })).getPayload());
    const setCookie = (res, name, value, maxAge) =>
        res.setHeader(
            "Set-Cookie",
            `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
        );
    const session = (req) => {
        const token = cookie(req, "planmate_session");
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        return (
            db
                .prepare(
                    "SELECT s.*,a.id,a.name,a.email,a.profile,a.profile_revision FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE hash=? AND expires>?",
                )
                .get(hash(token), now()) || null
        );
    };
    function csrf(req, user) {
        if (!user) fail(401, "Sign in to your account first.");
        if (req.headers["x-planmate-csrf"] !== user.csrf)
            fail(403, "Session security check failed. Reload and try again.");
    }
    function info(user) {
        return user
            ? {
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  profile: JSON.parse(user.profile),
                  profileRevision: user.profile_revision,
                  csrf: user.csrf,
              }
            : null;
    }
    async function handle(req, res, route, value, json) {
        if (route === "config" && req.method === "GET")
            return json(res, 200, {
                configured,
                required,
                clientId,
                mode: required ? "accounts-required" : "guest",
                secure,
            });
        if (route === "session" && req.method === "GET")
            return json(res, 200, { account: info(session(req)) });
        if (route === "challenge" && req.method === "GET") {
            if (!configured)
                fail(
                    503,
                    "Verified sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.",
                );
            const token = random(),
                nonce = random();
            db.prepare("DELETE FROM challenges WHERE expires<?").run(now());
            db.prepare("INSERT INTO challenges VALUES(?,?,?)").run(
                hash(token),
                nonce,
                now() + 300000,
            );
            setCookie(res, "planmate_challenge", token, 300);
            return json(res, 200, { nonce });
        }
        if (route === "google" && req.method === "POST") {
            if (!configured) fail(503, "Verified sign-in is not configured.");
            const key = hash(cookie(req, "planmate_challenge")),
                challenge = db
                    .prepare("SELECT * FROM challenges WHERE hash=? AND expires>?")
                    .get(key, now());
            if (!challenge) fail(403, "Sign-in expired. Reload and try again.");
            let claims;
            try {
                claims = await verifyToken(value.credential);
            } catch {
                fail(401, "Google could not verify this sign-in.");
            }
            if (
                !claims?.sub ||
                typeof claims.sub !== "string" ||
                claims.sub.length > 255 ||
                claims.aud !== clientId ||
                !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
                !Number.isFinite(claims.exp) ||
                claims.exp * 1000 <= now() ||
                claims.email_verified !== true ||
                claims.nonce !== challenge.nonce
            )
                fail(401, "Google identity checks failed. Start sign-in again.");
            let user;
            store.transaction(() => {
                if (
                    !db.prepare("DELETE FROM challenges WHERE hash=? AND expires>?").run(key, now())
                        .changes
                )
                    fail(403, "This sign-in was already used or expired.");
                user = db.prepare("SELECT * FROM accounts WHERE subject=?").get(claims.sub);
                if (!user) {
                    const id = crypto.randomUUID(),
                        name = String(claims.name || "Traveller").slice(0, 60),
                        email = String(claims.email || "").slice(0, 254);
                    db.prepare(
                        "INSERT INTO accounts(id,subject,name,email,profile) VALUES(?,?,?,?,?)",
                    ).run(id, claims.sub, name, email, JSON.stringify({ name, wishlist: [] }));
                    user = db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
                }
                const old = cookie(req, "planmate_session");
                if (old) db.prepare("DELETE FROM sessions WHERE hash=?").run(hash(old));
                const token = random(),
                    csrfToken = random();
                db.prepare("DELETE FROM sessions WHERE expires<?").run(now());
                db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
                    hash(token),
                    user.id,
                    csrfToken,
                    now() + 7 * 86400000,
                );
                setCookie(res, "planmate_session", token, 7 * 86400);
            });
            return json(res, 200, { signedIn: true });
        }
        const user = session(req);
        csrf(req, user);
        if (route === "signout" && req.method === "POST") {
            db.prepare(
                value.allDevices === true
                    ? "DELETE FROM sessions WHERE account_id=?"
                    : "DELETE FROM sessions WHERE hash=?",
            ).run(value.allDevices === true ? user.id : user.hash);
            setCookie(res, "planmate_session", "", 0);
            return json(res, 200, { signedOut: true });
        }
        fail(404, "Account endpoint not found.");
    }
    return { configured, required, secure, session, csrf, info, handle, hash };
}
module.exports = { createAccounts };
