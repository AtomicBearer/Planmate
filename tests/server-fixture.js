"use strict";
const { createPlannerServer: createServer } = require("../server/index.js");
// Disposable stores and explicit provider environments keep tests independent of
// real data and any credentials inherited from the developer's shell.
function createPlannerServer(options = {}) {
    return createServer({
        dataFile: null,
        ...options,
        discoveryOptions: { env: {}, ...options.discoveryOptions },
        mapOptions: { env: {}, ...options.mapOptions },
        accountOptions: { env: {}, ...options.accountOptions },
    });
}
module.exports = { createPlannerServer };
