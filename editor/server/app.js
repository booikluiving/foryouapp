"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const { loadExpress } = require("../../modules/catalog/server/express-loader");
const { catalogContentHash } = require("../../modules/catalog/write-model/catalog-content");
const { pathsContentHash } = require("../../modules/paths/db/paths-content");
const { numericPathId } = require("../../modules/paths/db/paths-store");
const { diffVersions } = require("./version-store");
const { CONTENT_ID, createVoorbeelden } = require("./voorbeelden");
const { IdeeFout, createIdeeen } = require("./ideeen");

const express = loadExpress();

const PUBLIC_DIR = path.resolve(__dirname, "../public");
const INJECTED_PAGES = /^\/(catalog|editor|universe)(\/|$)/;
// The injected script and stylesheet are cached by browsers; a version taken from their
// content makes a new deploy load at once (an old balk.js would send no save basis).
const INJECTED_VERSION = crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(PUBLIC_DIR, "_editor", "balk.js")))
  .update(fs.readFileSync(path.join(PUBLIC_DIR, "_editor", "huisstijl.css")))
  .digest("hex").slice(0, 10);
// The pages' own scripts and styles need one too: Cloudflare lets browsers keep a .js or .css
// file for 4 hours, so without it a deploy would reach some browsers only hours later.
const PAGE_FILE_DIRS = ["modules/catalog/ui", "shared/ui", "modules/paths/editor", "modules/paths/universe/public", "editor/public/versies", "editor/public/ideeen"]
  .map((dir) => path.resolve(__dirname, "../..", dir));

function filesVersion(dirs) {
  const hash = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css)$/.test(entry.name)) hash.update(full).update(fs.readFileSync(full));
    }
  };
  dirs.filter((dir) => fs.existsSync(dir)).forEach(walk);
  return hash.digest("hex").slice(0, 10);
}

const PAGE_FILES_VERSION = filesVersion(PAGE_FILE_DIRS);

// Puts that version behind every script and stylesheet of this site in a page (not behind the
// injected ones, which have their own, and not behind another site's).
function versionPageFiles(html) {
  return html.replace(
    /(<(?:script|link)\b[^>]*?\b(?:src|href)=)(["'])((?![a-z][a-z0-9+.-]*:|\/\/|\/_editor\/)[^"'#?]+\.(?:js|css))(\?[^"'#]*)?\2/gi,
    (_all, start, quote, file, query) => `${start}${quote}${file}${query ? `${query}&` : "?"}v=${PAGE_FILES_VERSION}${quote}`,
  );
}
const CATALOG_PREFIXES = ["/v0/catalog/", "/catalog", "/shared/ui/"];
const PATHS_PREFIXES = ["/v0/paths/", "/editor", "/universe"];
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "accept-language", "if-none-match", "if-modified-since", "range"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control", "etag", "last-modified", "location", "content-range", "accept-ranges"];
const DATA_READS = new Set(["/v0/catalog/read-model", "/v0/catalog/validation", "/v0/catalog/media-assets", "/v0/paths/editor-state", "/v0/paths/universe-state", "/v0/paths/read-model", "/v0/paths/validation"]);
const MEDIA_UPLOAD_PATH = "/v0/catalog/media-assets/upload";
const MEDIA_FILE_PREFIX = "/v0/catalog/media-assets/file/";
const MEDIA_PREVIEW_PREFIX = "/v0/catalog/media-assets/voorbeeld/";
// A file whose id holds its content hash never changes, so the browser may keep it.
const KEEP = "private, max-age=31536000, immutable";
// Cloudflare takes at most 100 MB per request on this plan.
const MEDIA_UPLOAD_LIMIT = "100mb";

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (_err) {
    return "";
  }
}

// Which records a write touches, so a stale editor cannot overwrite someone else's change.
function classifyRequest(method, pathname, body) {
  // The whole-content and media-file exchange is for the sync only, never through here.
  if (pathname === "/v0/catalog/content" || pathname === "/v0/paths/store" || pathname.startsWith("/v0/catalog/media-files")) return { kind: "blocked" };
  if (method === "GET" || method === "HEAD") return { kind: "read" };
  if (method === "POST" && pathname === "/v0/paths/evaluate") return { kind: "read" };
  const entity = pathname.match(/^\/v0\/catalog\/(performers|characters|environments|situations)(?:\/([^/]+))?$/);
  if (entity) {
    if (!entity[2] && method === "POST") return { kind: "write", keys: [] };
    if (entity[2] && (method === "PATCH" || method === "PUT")) return { kind: "write", keys: [decodeSegment(entity[2])] };
  }
  const pathId = (value) => `path:${numericPathId(value)}`;
  if (method === "POST" && pathname === "/v0/paths/paths/upsert") return { kind: "write", keys: body && body.id ? [pathId(body.id)] : [] };
  const pathPut = pathname.match(/^\/v0\/paths\/paths\/([^/]+)$/);
  if (method === "PUT" && pathPut) return { kind: "write", keys: [pathId(decodeSegment(pathPut[1]))] };
  if (method === "POST" && pathname === "/v0/paths/crossing-thresholds/upsert") {
    return { kind: "write", keys: [`crossing:${Number(body && (body.sceneId || body.targetSceneId)) || 0}`] };
  }
  const crossingPut = pathname.match(/^\/v0\/paths\/crossing-thresholds\/([^/]+)$/);
  if (method === "PUT" && crossingPut) return { kind: "write", keys: [`crossing:${Number(decodeSegment(crossingPut[1])) || 0}`] };
  if (method === "POST" && (pathname === "/v0/paths/archive" || pathname === "/v0/paths/delete")) {
    return { kind: "write", keys: [pathId(body && body.id)] };
  }
  // The image catalog. An upload only adds (an earlier file of the same kind is kept as a
  // backup), so it has nothing to collide with; removing and composing do.
  if (method === "POST" && pathname === MEDIA_UPLOAD_PATH) return { kind: "write", keys: [] };
  const mediaDelete = pathname.match(/^\/v0\/catalog\/media-assets\/([^/]+)$/);
  if (method === "DELETE" && mediaDelete) return { kind: "write", keys: [decodeSegment(mediaDelete[1])] };
  const composition = pathname.match(/^\/v0\/catalog\/media-compositions\/([^/]+)$/);
  if (method === "PUT" && composition) return { kind: "write", keys: [`composition:${decodeSegment(composition[1])}`] };
  return { kind: "blocked" };
}

const ENTITY_WORDS = { situations: "Situatie", characters: "Personage", environments: "Omgeving", performers: "Performer" };
const MEDIA_WORDS = { background: "Achtergrond", soundscape: "Geluid", fxImage: "Effectbeeld", fxVideo: "Effectvideo" };

// `answer` is the service's reply, `environmentName` looks a name up in the catalog.
function describeWrite(method, pathname, body, answer = null, environmentName = () => "") {
  const asset = answer && answer.asset;
  if (pathname === MEDIA_UPLOAD_PATH || (method === "DELETE" && pathname.startsWith("/v0/catalog/media-assets/"))) {
    const what = (asset && MEDIA_WORDS[asset.role]) || "Media";
    const where = asset ? asset.environmentName || environmentName(asset.environmentId) : "";
    return `${what} ${method === "DELETE" ? "verwijderd" : "toegevoegd"}${where ? ` bij ${where}` : ""}`;
  }
  if (pathname.startsWith("/v0/catalog/media-compositions/")) {
    const id = decodeSegment(pathname.split("/").pop());
    return `Compositie aangepast: ${environmentName(id) || id}`;
  }
  const name = body && (body.title || body.name) ? `: ${String(body.title || body.name).slice(0, 80)}` : "";
  const entity = pathname.match(/^\/v0\/catalog\/(performers|characters|environments|situations)(\/|$)/);
  if (entity) return `${ENTITY_WORDS[entity[1]]} ${method === "POST" ? "toegevoegd" : "aangepast"}${name}`;
  if (pathname.startsWith("/v0/paths/paths")) return `Pad ${body && body.id ? "aangepast" : "toegevoegd"}${name}`;
  if (pathname.startsWith("/v0/paths/crossing-thresholds")) return "Kruising aangepast";
  if (pathname === "/v0/paths/archive") return "Pad gearchiveerd";
  if (pathname === "/v0/paths/delete") return "Gearchiveerd pad verwijderd";
  return `${method} ${pathname}`;
}

function serviceFor(pathname, urls) {
  if (CATALOG_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) return urls.catalogUrl;
  if (PATHS_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) return urls.pathsUrl;
  return null;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Only a page the browser opens itself gets the team bar, not one a script asks for.
function isPageVisit(req) {
  if (req.headers["x-requested-with"] === "XMLHttpRequest") return false;
  const dest = req.headers["sec-fetch-dest"];
  return dest ? dest === "document" : /text\/html/i.test(req.headers.accept || "");
}

// The team bar of www.foryouniverse.nl ("Team / Voorstelling", the first name on the right), put inline
// into every page (navigatie/09-ontwerp-def.md, 9.7). Its files come from a folder the hub keeps up to
// date, read again at most once a minute. Without that folder every page is served as before.
function createTeambalk({ dir, namesFile } = {}) {
  let bar = null;
  let readAt = 0;
  let lastProblem = "";
  const report = (problem) => {
    if (problem && problem !== lastProblem) process.stderr.write(`teambalk: ${problem}\n`);
    lastProblem = problem;
  };
  const load = () => {
    if (Date.now() - readAt < 60 * 1000) return bar;
    readAt = Date.now();
    try {
      // Both go inline, where a closing tag inside (balk.js has one in its opening comment) would end the
      // block early. Written as "<\/" it means the same to the script and the stylesheet.
      const js = fs.readFileSync(path.join(dir, "balk.js"), "utf8").replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
      const css = fs.readFileSync(path.join(dir, "balk.css"), "utf8").replace(/<\/(style)/gi, "<\\/$1");
      let names = {};
      if (namesFile) {
        try {
          names = JSON.parse(fs.readFileSync(namesFile, "utf8"));
        } catch (err) {
          report(`namen niet gelezen (${err.code || err.message})`);
        }
      }
      bar = { js, css, names: Object.fromEntries(Object.entries(names).map(([email, name]) => [email.toLowerCase(), name])) };
      report("");
    } catch (err) {
      bar = null;
      report(err.code === "ENOENT" ? `geen balk in ${dir}` : err.message);
    }
    return bar;
  };
  function addTeambalk(html, email) {
    const current = dir ? load() : null;
    const body = html.match(/<body[^>]*>/i);
    if (!current || !body || !/<\/head>/i.test(html)) return html;
    const name = current.names[String(email || "").toLowerCase()];
    const script = `<script id="fy-balk-js" data-plek="voorstelling"${name ? ` data-naam="${escapeAttribute(name)}"` : ""}>${current.js}</script>`;
    // Replacement functions, so a "$" in the bar's code is taken literally.
    return html
      .replace(/<\/head>/i, () => `<style id="fy-balk-css">${current.css}</style></head>`)
      .replace(body[0], () => `${body[0]}${script}`);
  }
  // The first name for an address from the same list ("" when unknown).
  addTeambalk.naam = (email) => {
    const current = dir ? load() : null;
    return (current && current.names[String(email || "").toLowerCase()]) || "";
  };
  return addTeambalk;
}

function createLock() {
  let tail = Promise.resolve();
  return function withLock(work) {
    const run = tail.then(() => work());
    tail = run.catch(() => {});
    return run;
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 15000) });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_err) {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const err = new Error((body && (body.error || body.message)) || `HTTP ${response.status}`);
    err.statusCode = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function createEditorApp({ catalogUrl, pathsUrl, store, authenticate, config = {} }) {
  const app = express();
  const withLock = createLock();
  const urls = { catalogUrl, pathsUrl };
  const autoRelease = Boolean(config.autoRelease);
  const addTeambalk = createTeambalk(config.teambalk);
  const refused = new Set((config.refused || []).map((email) => email.toLowerCase()));
  const voorbeeld = createVoorbeelden({ catalogUrl, dir: config.voorbeeldDir || undefined });
  const ideeen = createIdeeen({ dir: path.join(store.dataDir, "ideeen") });
  // A first name for everyone on the ideas page; without one, the part of the address before the @.
  const naam = (email) => addTeambalk.naam(email) || String(email || "").split("@")[0];

  app.disable("x-powered-by");

  async function currentContent() {
    const [catalog, paths, media] = await Promise.all([
      fetchJson(`${catalogUrl}/v0/catalog/content`),
      fetchJson(`${pathsUrl}/v0/paths/store`),
      fetchJson(`${catalogUrl}/v0/catalog/media-files`, { timeoutMs: 120000 }),
    ]);
    return { catalog: catalog.content, paths: paths.content, media: media.files, hashes: { catalog: catalog.hash, paths: paths.hash } };
  }

  async function currentValidation() {
    const [catalog, paths] = await Promise.all([
      fetchJson(`${catalogUrl}/v0/catalog/validation`),
      fetchJson(`${pathsUrl}/v0/paths/validation`),
    ]);
    const counts = (result) => ({ ok: Boolean(result && result.ok), ...((result && result.counts) || {}) });
    return {
      ok: Boolean(catalog && catalog.ok && paths && paths.ok),
      catalog: counts(catalog),
      paths: counts(paths),
      errors: [...(catalog.issues || []), ...(paths.issues || [])].filter((issue) => issue.severity === "error").slice(0, 20),
    };
  }

  function releaseIfAllowed(version) {
    if (autoRelease && version.validation && version.validation.ok) {
      store.updateState(() => ({ released: version.nr, releasedAt: new Date().toISOString(), releasedBy: "automatisch" }));
    }
  }

  // Must run inside the lock. Returns the head version, new or unchanged.
  async function captureVersion({ author, reason, kind = "bewerking", extra = {} }) {
    const content = await currentContent();
    const head = store.head();
    if (head && head.hashes.catalog === content.hashes.catalog && head.hashes.paths === content.hashes.paths) return head;
    const validation = await currentValidation();
    // Which file each media record points to, so the show Mac can fetch and check it.
    const version = store.add({ catalog: content.catalog, paths: content.paths, hashes: content.hashes, author, reason, kind, validation, extra: { ...extra, media: content.media } });
    releaseIfAllowed(version);
    return version;
  }

  // Replaces the working content of the editor with `content`; must run inside the lock.
  async function installContent(content, expected) {
    const putJson = (url, body) => fetchJson(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 30000 });
    const catalogResult = await putJson(`${catalogUrl}/v0/catalog/content`, { expectedHash: expected.catalog, content: content.catalog });
    try {
      await putJson(`${pathsUrl}/v0/paths/store`, { expectedHash: expected.paths, content: content.paths });
    } catch (err) {
      await putJson(`${catalogUrl}/v0/catalog/content`, { expectedHash: catalogResult.hash, content: (await store.head()).catalog }).catch(() => {});
      throw err;
    }
  }

  async function reconcileOnStart() {
    return withLock(async () => {
      const state = store.readState();
      if (!state.head) {
        const version = await captureVersion({ author: "beginstand", reason: "Beginstand, gelijk aan de show-Mac", kind: "begin" });
        store.updateState(() => ({ released: version.nr, releasedAt: version.at, releasedBy: "beginstand" }));
        return version;
      }
      const head = store.head();
      if (head && !Array.isArray(head.catalog && head.catalog.mediaAssets)) {
        // Versions made before the image catalog travelled along: same catalog, now with
        // its media. If the old head was in the show, this one is too.
        const version = await captureVersion({ author: "editor", reason: "Beeldcatalogus (beelden, geluiden, composities) opgenomen in de versies", kind: "uitbreiding" });
        if (version.nr !== head.nr && state.released === head.nr && version.validation && version.validation.ok) {
          store.updateState(() => ({ released: version.nr, releasedAt: version.at, releasedBy: "editor" }));
        }
        return version;
      }
      // A planned change made while the editor was stopped (a migration, say) may leave its reason in
      // herstart-reden.json ({ "reason": "…", "author": "…" }). It is read once.
      const planned = path.join(store.dataDir, "herstart-reden.json");
      let reden = {};
      try {
        reden = JSON.parse(fs.readFileSync(planned, "utf8")) || {};
      } catch (_err) {
        reden = {};
      }
      try {
        fs.rmSync(planned, { force: true });
      } catch (err) {
        // The editor starts anyway; the reason would then be used again at the next start.
        process.stderr.write(`herstart-reden.json niet weggehaald: ${err.code || err.message}\n`);
      }
      const text = (value, fallback) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback);
      return captureVersion({ author: text(reden.author, "onbekend"), reason: text(reden.reason, "Buiten de editor gewijzigd"), kind: "herstel" });
    });
  }

  // ---- Show Mac (service token + shared secret) ----
  const sync = express.Router();
  sync.use(asyncRoute(async (req, res, next) => {
    const header = String(req.headers.authorization || "");
    const secretOk = sameSecret(header.replace(/^Bearer\s+/i, ""), config.syncSecret);
    const identity = await authenticate(req, { kind: "sync" });
    if (!secretOk || !identity.ok) {
      res.status(401).json({ ok: false, error: "niet_toegestaan" });
      return;
    }
    next();
  }));
  sync.use(express.json({ limit: "20mb" }));

  function syncStand() {
    const state = store.readState();
    const released = state.released ? store.summary(store.read(state.released)) : null;
    return {
      ok: true,
      head: state.head,
      released: released ? { nr: released.nr, hashes: released.hashes, at: released.at, author: released.author } : null,
      conflict: state.conflict ? { id: state.conflict.id, basis: state.conflict.basis } : null,
      overwriteLocal: state.overwriteLocal || null,
    };
  }

  sync.get("/stand", (_req, res) => res.json(syncStand()));

  sync.get("/versies/:nr", (req, res) => {
    const nr = Number(req.params.nr);
    const state = store.readState();
    if (!Number.isInteger(nr) || nr < 1 || nr > state.head) {
      res.status(404).json({ ok: false, error: "versie_onbekend" });
      return;
    }
    res.json({ ok: true, version: store.read(nr) });
  });

  // Which version has exactly this content (newest first), for a show Mac that starts fresh.
  sync.get("/zoek", (req, res) => {
    const state = store.readState();
    for (let nr = state.head; nr >= 1; nr -= 1) {
      const version = store.summary(store.read(nr));
      if (version.hashes.catalog === req.query.catalog && version.hashes.paths === req.query.paths) {
        res.json({ ok: true, nr });
        return;
      }
    }
    res.json({ ok: true, nr: null });
  });

  sync.post("/melding", (req, res) => {
    const report = req.body && typeof req.body === "object" ? req.body : {};
    store.updateState(() => ({ showMac: { ...report, receivedAt: new Date().toISOString() } }));
    res.json(syncStand());
  });

  // The show Mac has changes of its own. They are never lost: either they become the
  // next version, or they wait as a proposal until someone on the website decides.
  sync.post("/upload", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const catalog = body.catalog;
    const paths = body.paths;
    if (!catalog || !paths) {
      res.status(400).json({ ok: false, error: "inhoud_ontbreekt" });
      return;
    }
    const hashes = { catalog: catalogContentHash(catalog), paths: pathsContentHash(paths) };
    if (!body.hashes || body.hashes.catalog !== hashes.catalog || body.hashes.paths !== hashes.paths) {
      res.status(400).json({ ok: false, error: "vingerafdruk_klopt_niet" });
      return;
    }
    const result = await withLock(async () => {
      const state = store.readState();
      const head = store.head();
      if (head && head.hashes.catalog === hashes.catalog && head.hashes.paths === hashes.paths) {
        return { status: "al_bekend", nr: head.nr };
      }
      if (Number(body.basis) === state.head && !state.conflict) {
        await installContent({ catalog, paths }, head.hashes);
        const version = await captureVersion({ author: "show-Mac", reason: body.reason || "Gewijzigd op de show-Mac", kind: "show-mac" });
        if (state.released === Number(body.basis)) {
          store.updateState(() => ({ released: version.nr, releasedAt: version.at, releasedBy: "show-Mac" }));
        }
        return { status: "opgenomen", nr: version.nr };
      }
      const id = `voorstel-${Date.now()}`;
      const basisVersion = Number(body.basis) ? store.read(Number(body.basis)) : null;
      const proposal = { id, at: new Date().toISOString(), basis: Number(body.basis) || 0, headAtUpload: state.head, catalog, paths, hashes };
      store.writeFileAtomic(path.join(store.dataDir, "voorstellen", `${id}.json`), JSON.stringify(proposal));
      store.updateState(() => ({
        conflict: {
          id,
          at: proposal.at,
          basis: proposal.basis,
          headAtUpload: state.head,
          changes: diffVersions(basisVersion, { catalog, paths }),
        },
        overwriteLocal: null,
      }));
      return { status: "conflict", id };
    });
    res.json({ ok: true, ...result });
  }));

  // Media files travel separately from the content, by relative path and SHA-256.
  sync.get("/media", asyncRoute(async (req, res) => {
    const response = await fetch(`${catalogUrl}/v0/catalog/media-files/raw?pad=${encodeURIComponent(String(req.query.pad || ""))}`, {
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    res.status(response.status);
    for (const name of ["content-type", "content-length", "x-sha256"]) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!response.body) {
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body), res);
  }));

  sync.post("/media/ontbrekend", asyncRoute(async (req, res) => {
    const files = (req.body && req.body.files) || {};
    const answer = await fetchJson(`${catalogUrl}/v0/catalog/media-files/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files }),
      timeoutMs: 120000,
    });
    res.json({ ok: true, missing: answer.missing || [] });
  }));

  sync.put("/media", asyncRoute(async (req, res) => {
    const query = `pad=${encodeURIComponent(String(req.query.pad || ""))}&sha256=${encodeURIComponent(String(req.query.sha256 || ""))}`;
    const response = await fetch(`${catalogUrl}/v0/catalog/media-files/raw?${query}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: req,
      duplex: "half",
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    res.status(response.status).type("application/json").send(Buffer.from(await response.arrayBuffer()));
  }));

  app.use("/sync/v1", sync);

  // ---- Team members (Access login) ----
  app.use(asyncRoute(async (req, res, next) => {
    const identity = await authenticate(req, { kind: "team" });
    if (!identity.ok || !identity.email) {
      res.status(identity.status || 401).type("text/plain").send("Log in via www.foryouniverse.nl/team/");
      return;
    }
    // Team logins that are not for the show, such as the build iPad (Team, Bouwplan and Spullen only).
    if (refused.has(identity.email.toLowerCase())) {
      res.status(403).type("text/plain").send("Dit account heeft geen toegang tot de Voorstelling.");
      return;
    }
    req.editorUser = identity.email;
    next();
  }));

  // The start of the Voorstelling is its first tab.
  app.get("/", (_req, res) => res.redirect("/catalog/"));
  app.use("/_editor", express.static(path.join(PUBLIC_DIR, "_editor")));
  // Our own pages (Versies, Ideeën): with the team bar, and the version behind their scripts.
  const ownPage = (name) => (req, res) => {
    const html = versionPageFiles(fs.readFileSync(path.join(PUBLIC_DIR, name, "index.html"), "utf8"));
    res.setHeader("cache-control", "no-store");
    res.type("html").send(isPageVisit(req) ? addTeambalk(html, req.editorUser) : html);
  };
  app.get(["/versies/", "/versies/index.html"], ownPage("versies"));
  app.use("/versies", express.static(path.join(PUBLIC_DIR, "versies"), { extensions: ["html"] }));
  app.get("/ideeen/foto/:file", (req, res) => {
    const file = ideeen.fotoPath(req.params.file);
    if (!file) {
      res.status(404).type("text/plain").send("Deze foto is er niet (meer).");
      return;
    }
    res.setHeader("cache-control", KEEP);
    res.type("image/webp").sendFile(file, { cacheControl: false });
  });
  app.get(["/ideeen/", "/ideeen/index.html"], ownPage("ideeen"));
  app.use("/ideeen", express.static(path.join(PUBLIC_DIR, "ideeen"), { extensions: ["html"] }));

  // The image catalog's overview asks for small previews (window.fyVoorbeeld in balk.js). For
  // a file without one (not a picture, or unreadable) the browser is sent to the original.
  app.get(`${MEDIA_PREVIEW_PREFIX}:assetId`, asyncRoute(async (req, res) => {
    const file = await voorbeeld(req.params.assetId);
    if (!file) {
      res.redirect(302, `${MEDIA_FILE_PREFIX}${encodeURIComponent(req.params.assetId)}`);
      return;
    }
    res.setHeader("cache-control", KEEP);
    res.type("image/webp").sendFile(file, { cacheControl: false });
  }));

  const api = express.Router();
  api.use(express.json({ limit: "64kb" }));

  api.get("/stand", (req, res) => {
    const state = store.readState();
    const pick = (nr) => (nr ? store.summary(store.read(nr)) : null);
    res.json({
      ok: true,
      me: req.editorUser,
      autoRelease,
      head: pick(state.head),
      released: pick(state.released),
      releasedAt: state.releasedAt || null,
      releasedBy: state.releasedBy || null,
      showMac: state.showMac || null,
      conflict: state.conflict || null,
      overwriteLocal: state.overwriteLocal || null,
    });
  });

  api.get("/versies", (req, res) => {
    res.json({ ok: true, versions: store.list({ limit: Math.min(500, Number(req.query.limit) || 100) }) });
  });

  api.post("/vrijgeven", asyncRoute(async (req, res) => {
    const nr = Number(req.body && req.body.nr);
    const result = await withLock(async () => {
      const state = store.readState();
      if (!Number.isInteger(nr) || nr < 1 || nr > state.head) return { status: 404, body: { ok: false, error: "versie_onbekend" } };
      const version = store.read(nr);
      if (!version.validation || !version.validation.ok) {
        return { status: 409, body: { ok: false, error: "versie_heeft_fouten", message: "Deze versie heeft fouten en kan niet de show in." } };
      }
      store.updateState(() => ({ released: nr, releasedAt: new Date().toISOString(), releasedBy: req.editorUser }));
      return { status: 200, body: { ok: true, released: nr } };
    });
    res.status(result.status).json(result.body);
  }));

  api.post("/terugzetten", asyncRoute(async (req, res) => {
    const nr = Number(req.body && req.body.nr);
    const result = await withLock(async () => {
      const state = store.readState();
      if (!Number.isInteger(nr) || nr < 1 || nr > state.head) return { status: 404, body: { ok: false, error: "versie_onbekend" } };
      const old = store.read(nr);
      const head = store.head();
      await installContent({ catalog: old.catalog, paths: old.paths }, head.hashes);
      const version = await captureVersion({ author: req.editorUser, reason: `Versie ${nr} teruggezet`, kind: "terugzetten" });
      return { status: 200, body: { ok: true, nr: version.nr } };
    });
    res.status(result.status).json(result.body);
  }));

  api.post("/conflict/kies", asyncRoute(async (req, res) => {
    const choice = req.body && req.body.keuze;
    const result = await withLock(async () => {
      const state = store.readState();
      if (!state.conflict || state.conflict.id !== (req.body && req.body.id)) {
        return { status: 409, body: { ok: false, error: "geen_open_conflict" } };
      }
      const at = new Date().toISOString();
      if (choice === "show-mac") {
        const proposal = JSON.parse(fs.readFileSync(path.join(store.dataDir, "voorstellen", `${state.conflict.id}.json`), "utf8"));
        await installContent({ catalog: proposal.catalog, paths: proposal.paths }, store.head().hashes);
        const version = await captureVersion({ author: req.editorUser, reason: "Wijzigingen van de show-Mac overgenomen", kind: "show-mac", extra: { proposal: proposal.id } });
        store.updateState(() => ({
          conflict: null,
          released: version.validation.ok ? version.nr : state.released,
          releasedAt: at,
          releasedBy: req.editorUser,
          overwriteLocal: { id: state.conflict.id, by: req.editorUser, at },
        }));
        return { status: 200, body: { ok: true, nr: version.nr } };
      }
      if (choice === "website") {
        store.updateState(() => ({ conflict: null, overwriteLocal: { id: state.conflict.id, by: req.editorUser, at } }));
        return { status: 200, body: { ok: true } };
      }
      return { status: 400, body: { ok: false, error: "kies_show-mac_of_website" } };
    });
    res.status(result.status).json(result.body);
  }));

  // ---- Ideas: their own store, never a version, never to the show Mac ----
  const idee = (handler) => asyncRoute(async (req, res) => {
    try {
      res.json({ ok: true, ...(await handler(req)) });
    } catch (err) {
      if (!(err instanceof IdeeFout)) throw err;
      res.status(err.status).json({ ok: false, error: err.error, message: err.message });
    }
  });
  const sent = (req) => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {});
  api.get("/ideeen", idee(async (req) => ({ me: req.editorUser, ideeen: ideeen.view(req.editorUser, naam) })));
  api.post("/ideeen", idee(async (req) => ({ idee: await ideeen.add(req.editorUser, sent(req)) })));
  api.patch("/ideeen/:id", idee(async (req) => ({ idee: await ideeen.update(req.params.id, req.editorUser, sent(req)) })));
  api.delete("/ideeen/:id", idee(async (req) => ideeen.remove(req.params.id, req.editorUser)));
  api.put("/ideeen/:id/status", idee(async (req) => ({ idee: await ideeen.setStatus(req.params.id, req.editorUser, sent(req).status) })));
  api.post("/ideeen/:id/reacties", idee(async (req) => ({ reactie: await ideeen.addReactie(req.params.id, req.editorUser, sent(req).tekst) })));
  api.delete("/ideeen/:id/reacties/:reactie", idee(async (req) => ideeen.removeReactie(req.params.id, req.params.reactie, req.editorUser)));
  // A photo straight from the phone: up to 25 MB, stored much smaller.
  api.put("/ideeen/:id/foto", express.raw({ type: "image/*", limit: "25mb" }), idee(async (req) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new IdeeFout(400, "foto", "Kies een foto.");
    return { idee: await ideeen.setFoto(req.params.id, req.editorUser, req.body) };
  }));
  api.delete("/ideeen/:id/foto", idee(async (req) => ({ idee: await ideeen.removeFoto(req.params.id, req.editorUser) })));

  app.use("/api", api);

  // ---- The screens and their API, passed through ----
  const rawBody = express.raw({ type: () => true, limit: "5mb" });
  const uploadBody = express.raw({ type: () => true, limit: MEDIA_UPLOAD_LIMIT });
  const bodyFor = (req, res, next) => (req.path === MEDIA_UPLOAD_PATH ? uploadBody : rawBody)(req, res, next);

  app.use(bodyFor, asyncRoute(async (req, res, next) => {
    const pathname = req.path;
    const target = serviceFor(pathname, urls);
    if (!target) return next();
    const isApi = pathname.startsWith("/v0/");
    let body = null;
    if (isApi && Buffer.isBuffer(req.body) && req.body.length) {
      try {
        body = JSON.parse(req.body.toString("utf8"));
      } catch (_err) {
        body = null;
      }
    }
    const kind = isApi ? classifyRequest(req.method, pathname, body) : (req.method === "GET" || req.method === "HEAD" ? { kind: "read" } : { kind: "blocked" });
    if (kind.kind === "blocked") {
      res.status(403).json({ ok: false, error: "alleen_op_de_show_mac", message: "Dit kan alleen op de show-Mac zelf." });
      return;
    }

    const forward = async () => {
      const headers = {};
      for (const name of FORWARDED_REQUEST_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
      const hasBody = !["GET", "HEAD"].includes(req.method);
      const response = await fetch(`${target}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: hasBody && Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
    };

    const send = (result, extraHeaders = {}) => {
      res.status(result.status);
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = result.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
      let buffer = result.buffer;
      const type = result.headers.get("content-type") || "";
      if (!isApi && type.includes("text/html") && INJECTED_PAGES.test(pathname)) {
        // First in <head>, so it is in place before the page's own scripts load any data.
        let html = versionPageFiles(buffer.toString("utf8"));
        const tag = `<script src="/_editor/balk.js?v=${INJECTED_VERSION}"></script>`;
        const head = html.match(/<head[^>]*>/i);
        html = head ? html.replace(head[0], `${head[0]}${tag}`) : `${tag}${html}`;
        // Last in <head>, so the house style wins over the page's own styles. Its rules only
        // apply under html.hs, which balk.js sets (or not) before anything is drawn.
        const style = `<link rel="stylesheet" href="/_editor/huisstijl.css?v=${INJECTED_VERSION}">`;
        html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : `${style}${html}`;
        // The stage output is a picture for the show, not a team page: no team bar there.
        buffer = Buffer.from(pathname.startsWith("/universe/stage") || !isPageVisit(req) ? html : addTeambalk(html, req.editorUser));
        res.setHeader("cache-control", "no-store");
      }
      res.end(req.method === "HEAD" ? undefined : buffer);
    };

    if (kind.kind === "read") {
      if (pathname.startsWith(MEDIA_FILE_PREFIX) && req.method === "GET") {
        // Media files (up to 250 MB) are streamed through, not held in memory. A browser that stops
        // listening halfway (another page, a jump in a video) is normal: then the fetch stops too.
        const gone = new AbortController();
        res.on("close", () => gone.abort());
        const headers = {};
        for (const name of FORWARDED_REQUEST_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
        let response;
        try {
          response = await fetch(`${target}${req.originalUrl}`, { headers, signal: AbortSignal.any([gone.signal, AbortSignal.timeout(10 * 60 * 1000)]) });
        } catch (err) {
          if (gone.signal.aborted) return;
          throw err;
        }
        res.status(response.status);
        for (const name of [...FORWARDED_RESPONSE_HEADERS, "content-length"]) {
          const value = response.headers.get(name);
          if (value) res.setHeader(name, value);
        }
        if ((response.status === 200 || response.status === 206) && CONTENT_ID.test(decodeSegment(pathname.slice(MEDIA_FILE_PREFIX.length)))) {
          res.setHeader("cache-control", KEEP);
        }
        if (!response.body || res.destroyed) {
          if (response.body) await response.body.cancel().catch(() => {});
          res.end();
          return;
        }
        const body = Readable.fromWeb(response.body);
        // Without a listener, an error after the browser has left would end the whole editor.
        body.on("error", () => {});
        try {
          await pipeline(body, res);
        } catch (err) {
          const left = (err && err.code === "ERR_STREAM_PREMATURE_CLOSE") || (err && err.name === "AbortError");
          if (!left) console.error(`media ${pathname}: ${err && err.message ? err.message : err}`);
        }
        return;
      }
      if (isApi && DATA_READS.has(pathname)) {
        const result = await withLock(async () => ({ forwarded: await forward(), version: store.readState().head }));
        send(result.forwarded, { "x-foryou-versie": String(result.version), "cache-control": "no-store" });
        return;
      }
      send(await forward());
      return;
    }

    const author = req.editorUser;
    const outcome = await withLock(async () => {
      const basis = Number(req.headers["x-foryou-basis"]);
      if (!Number.isFinite(basis) || basis < 1) {
        return { refused: { status: 428, body: { ok: false, error: "herlaad", message: "Herlaad de pagina en probeer het opnieuw." } } };
      }
      const changed = store.changedSince(basis, author);
      for (const key of kind.keys) {
        const other = changed.get(key);
        if (other) {
          const time = new Date(other.at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
          return {
            refused: {
              status: 409,
              body: {
                ok: false,
                error: "conflict",
                message: `${other.author} heeft dit om ${time} ook aangepast (versie ${other.nr}). Jouw wijziging is niet opgeslagen. Herlaad de pagina en doe hem opnieuw.`,
              },
            },
          };
        }
      }
      const forwarded = await forward();
      let version = store.head();
      if (forwarded.status >= 200 && forwarded.status < 300) {
        let answer = null;
        try {
          answer = JSON.parse(forwarded.buffer.toString("utf8"));
        } catch (_err) {
          answer = null;
        }
        const head = store.head();
        const environmentName = (id) => {
          const environment = ((head && head.catalog && head.catalog.environments) || []).find((item) => item.id === id);
          return environment ? environment.name : "";
        };
        version = await captureVersion({ author, reason: describeWrite(req.method, pathname, body, answer, environmentName) });
      }
      return { forwarded, version: version ? version.nr : 0 };
    });
    if (outcome.refused) {
      res.status(outcome.refused.status).setHeader("x-foryou-versie", String(store.readState().head));
      res.json(outcome.refused.body);
      return;
    }
    send(outcome.forwarded, { "x-foryou-versie": String(outcome.version), "cache-control": "no-store" });
  }));

  app.use((req, res) => res.status(404).json({ ok: false, error: "not_found", path: req.path }));

  app.use((err, _req, res, _next) => {
    console.error(err && err.stack ? err.stack : err);
    if (res.headersSent) return;
    res.status(err.statusCode && err.statusCode < 600 ? err.statusCode : 500).json({
      ok: false,
      error: "editor_fout",
      message: err && err.message ? String(err.message) : "onbekende fout",
    });
  });

  return { app, reconcileOnStart, captureVersion, withLock };
}

module.exports = {
  classifyRequest,
  createEditorApp,
  createTeambalk,
  isPageVisit,
  versionPageFiles,
};
