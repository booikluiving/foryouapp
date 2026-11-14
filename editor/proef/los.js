"use strict";

// De proefshow los van de website, op deze computer: node editor/proef/los.js
// Leest de catalogus en de paden van de show (alleen lezen) en toont de werkplaats op
// http://127.0.0.1:4100/proefshow/. De bestanden komen uit de map waar dit script in staat,
// dus een wijziging in een pagina is na herladen meteen te zien.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createProefshow } = require("./proefshow");

const POORT = Number(process.env.PROEF_POORT || 4100);
const proef = createProefshow({
  dataDir: path.resolve(process.env.PROEF_DATA_DIR || path.join(__dirname, "../../tmp/proefshow")),
  catalogUrl: process.env.PROEF_CATALOG_URL || "http://127.0.0.1:3021",
  pathsUrl: process.env.PROEF_PATHS_URL || "http://127.0.0.1:3022",
  basisPoort: Number(process.env.PROEF_BASIS_POORT || 4120),
  adres: `http://127.0.0.1:${POORT}`,
});
const lezen = new URL(proef.leesAdres());
const UNIVERSUM = path.resolve(__dirname, "../../modules/paths/universe/public");
const SOORT = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(302, { location: "/proefshow/" });
    res.end();
    return;
  }
  proef.middleware(req, res, () => {
    // De pagina's van het universum komen uit deze map, niet van de show.
    const pathname = req.url.split("?")[0];
    if (pathname.startsWith("/universe/")) {
      const bestand = path.join(UNIVERSUM, path.normalize(pathname.slice("/universe/".length)));
      if (bestand.startsWith(UNIVERSUM) && fs.existsSync(bestand) && fs.statSync(bestand).isFile()) {
        res.writeHead(200, { "content-type": SOORT[path.extname(bestand)] || "application/octet-stream", "cache-control": "no-store" });
        res.end(fs.readFileSync(bestand));
        return;
      }
    }
    // Al het andere (universum, beelden uit de catalogus) komt via de leesdeur.
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
