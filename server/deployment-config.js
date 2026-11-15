"use strict";
// Render supplies its assigned HTTPS URL. A custom domain takes explicit precedence.
function publicOrigin(env = process.env) {
    return env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || "";
}
module.exports = { publicOrigin };
