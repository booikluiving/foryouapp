"use strict";

// Website editor for the show content: the catalog and paths services with their own
// data, behind one door that checks the login, keeps a version of every save and lets
// the show Mac pick up released versions.

const fs = require("node:fs");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(process.env.EDITOR_DATA_DIR || path.join(APP_ROOT, "editor", "data"));
const HOST = process.env.EDITOR_HOST || "0.0.0.0";
const PORT = Number(process.env.EDITOR_PORT || 8080);
const CATALOG_PORT = Number(process.env.EDITOR_CATALOG_PORT || 3021);
const PATHS_PORT = Number(process.env.EDITOR_PATHS_PORT || 3022);

process.env.CATALOG_DB_PATH = path.join(DATA_DIR, "catalog.sqlite");
process.env.CATALOG_MEDIA_ROOT = path.join(DATA_DIR, "media");
process.env.PATHS_STORE_PATH = path.join(DATA_DIR, "paths-store.json");
process.env.PATHS_CATALOG_URL = `http://127.0.0.1:${CATALOG_PORT}`;

const { createCatalogApp } = require("../../modules/catalog/server/app");
const { createPathsApp } = require("../../modules/paths/server/app");
const { createAccessVerifier } = require("./access-auth");
const { createEditorApp } = require("./app");
const { createVersionStore } = require("./version-store");

function fail(message) {
  process.stderr.write(`editor: ${message}\n`);
  process.exit(1);
}

function seedDataIfEmpty() {
  const dbPath = process.env.CATALOG_DB_PATH;
  const pathsPath = process.env.PATHS_STORE_PATH;
  if (fs.existsSync(dbPath) && fs.existsSync(pathsPath)) return;
  if (fs.existsSync(dbPath) !== fs.existsSync(pathsPath)) fail(`half gevulde datamap ${DATA_DIR}: catalogus en paden horen samen`);
  const seedDir = process.env.EDITOR_SEED_DIR;
  // Never start with an empty show: the first version must be the show Mac's content.
  if (!seedDir) fail(`geen data in ${DATA_DIR} en geen EDITOR_SEED_DIR om mee te beginnen`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // The media first: the catalog refers to them, and a version without its files would
  // never reach the show.
  const seedMedia = path.join(seedDir, "media");
  if (fs.existsSync(seedMedia)) {
    fs.cpSync(seedMedia, process.env.CATALOG_MEDIA_ROOT, { recursive: true, filter: (source) => path.basename(source) !== ".DS_Store" });
  }
  fs.copyFileSync(path.join(seedDir, "catalog.sqlite"), dbPath);
  fs.copyFileSync(path.join(seedDir, "paths-store.json"), pathsPath);
}

function authenticatorFromEnv() {
  const mode = process.env.EDITOR_AUTH || "access";
  if (mode === "test") {
    if (HOST !== "127.0.0.1") fail("EDITOR_AUTH=test mag alleen op 127.0.0.1");
    return async (req, { kind }) => {
      if (kind === "sync") return { ok: true };
      const email = String(req.headers["x-test-user"] || process.env.EDITOR_TEST_USER || "").toLowerCase();
      return email ? { ok: true, email } : { ok: false, status: 401 };
    };
  }
  if (mode !== "access") fail(`onbekende EDITOR_AUTH ${mode}`);
  const verifyToken = createAccessVerifier({
    teamDomain: process.env.EDITOR_ACCESS_TEAM_DOMAIN,
    audiences: String(process.env.EDITOR_ACCESS_AUD || "").split(",").map((value) => value.trim()),
  });
  const syncClientId = String(process.env.EDITOR_SYNC_CLIENT_ID || "");
  return async (req, { kind }) => {
    const token = req.headers["cf-access-jwt-assertion"];
    if (!token || Array.isArray(token)) return { ok: false, status: 401 };
    const result = await verifyToken(token);
    if (!result.ok) return { ok: false, status: 403, reason: result.reason };
    if (kind === "sync") return { ok: Boolean(syncClientId) && result.serviceClientId === syncClientId };
    return result.email ? { ok: true, email: result.email } : { ok: false, status: 403 };
  };
}

function listen(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.on("error", reject);
  });
}

async function main() {
  const syncSecret = String(process.env.EDITOR_SYNC_SECRET || "");
  if (syncSecret.length < 32) fail("EDITOR_SYNC_SECRET ontbreekt of is korter dan 32 tekens");
  seedDataIfEmpty();
  const authenticate = authenticatorFromEnv();
  await listen(createCatalogApp({ port: CATALOG_PORT }), CATALOG_PORT, "127.0.0.1");
  await listen(createPathsApp({ port: PATHS_PORT }), PATHS_PORT, "127.0.0.1");
  const store = createVersionStore(DATA_DIR);
  const editor = createEditorApp({
    catalogUrl: `http://127.0.0.1:${CATALOG_PORT}`,
    pathsUrl: `http://127.0.0.1:${PATHS_PORT}`,
    store,
    authenticate,
    config: {
      autoRelease: process.env.EDITOR_AUTO_RELEASE === "1",
      syncSecret,
      // The team bar (balk.js, balk.css) and the first names by e-mail address; both optional.
      teambalk: { dir: process.env.EDITOR_TEAMBALK_DIR || "", namesFile: process.env.EDITOR_TEAMNAMEN || "" },
      // Team logins that may not open the Voorstelling (comma-separated e-mail addresses).
      refused: String(process.env.EDITOR_GEWEIGERD || "").split(",").map((value) => value.trim()).filter(Boolean),
      // Where the image catalog's previews are kept; may be emptied at any time (default: the tmp folder).
      voorbeeldDir: process.env.EDITOR_VOORBEELD_DIR || "",
    },
  });
  const head = await editor.reconcileOnStart();
  await listen(editor.app, PORT, HOST);
  process.stdout.write(`editor op ${HOST}:${PORT}, data ${DATA_DIR}, versie ${head.nr}\n`);
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
