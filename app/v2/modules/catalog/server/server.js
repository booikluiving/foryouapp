"use strict";

const { createCatalogApp } = require("./app");

function catalogPort() {
  return Number(process.env.CATALOG_PORT || process.env.PORT || 3021);
}

function startCatalogServer(options = {}) {
  const port = Number(options.port || catalogPort());
  const app = createCatalogApp({ ...options, port });
  const server = app.listen(port, () => {
    process.stdout.write(`Catalog Service V0 listening on ${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startCatalogServer();
}

module.exports = {
  catalogPort,
  startCatalogServer,
};
