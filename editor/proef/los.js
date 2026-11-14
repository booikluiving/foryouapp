"use strict";

// De proefshow los van de website, op deze computer: node editor/proef/los.js
// Werkt op een kopie van de catalogus en de paden van de show en toont de werkplaats op
// http://127.0.0.1:4100/proefshow/. De bestanden komen uit de map waar dit script in staat,
// dus een wijziging in een pagina is na herladen meteen te zien.

const http = require("node:http");
const path = require("node:path");
const { createProefshow } = require("./proefshow");

const POORT = Number(process.env.PROEF_POORT || 4100);
const SHOW = path.resolve(process.env.PROEF_SHOW_DIR || "/Users/for_you/ForYou/main");
const proef = createProefshow({
  dataDir: path.resolve(process.env.PROEF_DATA_DIR || path.join(__dirname, "../../tmp/proefshow")),
  // De inhoud van de show op deze computer: er wordt een kopie van gemaakt, de beelden worden alleen gelezen.
  inhoud: {
    catalogDb: process.env.PROEF_CATALOG_DB || path.join(SHOW, "modules/catalog/db/catalog.sqlite"),
    pathsStore: process.env.PROEF_PATHS_STORE || path.join(SHOW, "modules/paths/db/paths-store.json"),
    mediaRoot: process.env.PROEF_MEDIA_ROOT || path.join(SHOW, "modules/catalog/media"),
  },
  basisPoort: Number(process.env.PROEF_BASIS_POORT || 4120),
  adres: `http://127.0.0.1:${POORT}`,
});
const lezen = new URL(proef.leesAdres());

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(302, { location: "/proefshow/" });
    res.end();
    return;
  }
  proef.middleware(req, res, () => {
    // Al het andere (beelden uit de catalogus) komt via de leesdeur.
    const uit = http.request({ hostname: lezen.hostname, port: lezen.port, path: req.url, method: req.method, headers: { ...req.headers, host: lezen.host } }, (antwoord) => {
      res.writeHead(antwoord.statusCode || 502, antwoord.headers);
      antwoord.pipe(res);
    });
    uit.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(uit);
  });
});
server.on("upgrade", (req, socket, head) => {
  if (!proef.upgrade(req, socket, head)) socket.destroy();
});

proef.start({ instellingenVan: process.env.PROEF_INSTELLINGEN_VAN || "" }).then(() => {
  server.listen(POORT, "127.0.0.1", () => process.stdout.write(`proefshow: werkplaats op http://127.0.0.1:${POORT}/proefshow/\n`));
});
for (const sein of ["SIGINT", "SIGTERM"]) process.on(sein, () => { proef.stop(); process.exit(0); });
