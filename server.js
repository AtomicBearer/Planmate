"use strict";

// Keep existing launch commands working after organizing implementation files.
const app = require("./server/index.js");
if (require.main === module) app.start();
module.exports = app;
