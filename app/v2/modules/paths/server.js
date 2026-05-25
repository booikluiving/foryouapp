"use strict";

const { pathsPort, startPathsServer } = require("./server/server");

if (require.main === module) {
  startPathsServer();
}

module.exports = {
  pathsPort,
  startPathsServer,
};
