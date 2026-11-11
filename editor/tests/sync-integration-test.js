"use strict";

// Website editor + show Mac, end to end: the editor and the show Mac's catalog and paths
// services run as real processes on copies of the data, the runtime is a stand-in, and
// the sync agent runs here. Every scenario checks that nothing is lost or half applied.
// Seed: FORYOU_TEST_SEED_DIR (catalog.sqlite + paths-store.json), else this checkout's own data;
// media: FORYOU_TEST_MEDIA_DIR, else this checkout's modules/catalog/media.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const { createAgent } = require("../../sync-agent/agent");

const ROOT = path.resolve(__dirname, "../..");
const WORK = path.join(ROOT, "editor", "tests", "tmp", `run-${process.pid}-${Date.now()}`);
const SECRET = "test-geheim-0123456789-abcdefghijklmnop";
const children = [];
const results = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function copySqlite(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

// A clone where the file system can (APFS: instant, no extra space), else a real copy.
function copyTree(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    execFileSync("cp", ["-c", "-R", from, to], { stdio: "ignore" });
  } catch (_err) {
    fs.cpSync(from, to, { recursive: true });
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// A 1×1 PNG, a different one each time (the colour byte changes).
function tinyPng(variant) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  return Buffer.concat([png, Buffer.from(`\n${variant}`)]);
}

function start(name, script, env) {
  const child = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk; });
  child.stderr.on("data", (chunk) => { child.output += chunk; });
  child.label = name;
  children.push(child);
  return child;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

async function waitFor(url, child) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (child && child.exitCode !== null) throw new Error(`${child.label} stopte:\n${child.output}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch (_err) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`${url} kwam niet op${child ? `:\n${child.output}` : ""}`);
}

async function call(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_err) {
    json = null;
  }
  return { status: response.status, headers: response.headers, json, text };
}

function scenario(name, fn) {
  return async () => {
    await fn();
    results.push(name);
    process.stdout.write(`  ok  ${name}\n`);
  };
}

async function main() {
  const seedDir = process.env.FORYOU_TEST_SEED_DIR;
  const seedCatalog = seedDir ? path.join(seedDir, "catalog.sqlite") : path.join(ROOT, "modules", "catalog", "db", "catalog.sqlite");
  const seedPaths = seedDir ? path.join(seedDir, "paths-store.json") : path.join(ROOT, "modules", "paths", "db", "paths-store.json");

  copySqlite(seedCatalog, path.join(WORK, "seed", "catalog.sqlite"));
  fs.copyFileSync(seedPaths, path.join(WORK, "seed", "paths-store.json"));
  copySqlite(seedCatalog, path.join(WORK, "show", "catalog.sqlite"));
  fs.copyFileSync(seedPaths, path.join(WORK, "show", "paths-store.json"));
  const seedMedia = process.env.FORYOU_TEST_MEDIA_DIR || path.join(ROOT, "modules", "catalog", "media");
  copyTree(seedMedia, path.join(WORK, "seed", "media"));
  copyTree(seedMedia, path.join(WORK, "show", "media"));

  const ports = { nas: await freePort(), nasCatalog: await freePort(), nasPaths: await freePort(), catalog: await freePort(), paths: await freePort(), runtime: await freePort() };
  const nasUrl = `http://127.0.0.1:${ports.nas}`;
  const showCatalog = `http://127.0.0.1:${ports.catalog}`;
  const showPaths = `http://127.0.0.1:${ports.paths}`;

  const nasEnv = {
    EDITOR_DATA_DIR: path.join(WORK, "nas"),
    EDITOR_SEED_DIR: path.join(WORK, "seed"),
    EDITOR_HOST: "127.0.0.1",
    EDITOR_PORT: String(ports.nas),
    EDITOR_CATALOG_PORT: String(ports.nasCatalog),
    EDITOR_PATHS_PORT: String(ports.nasPaths),
    EDITOR_AUTH: "test",
    EDITOR_SYNC_SECRET: SECRET,
    EDITOR_GEWEIGERD: "bouw@test.nl, iemand@test.nl",
    EDITOR_VOORBEELD_DIR: path.join(WORK, "voorbeelden"),
  };
  let nas = start("editor", "editor/server/server.js", nasEnv);
  const showCatalogProcess = start("show-catalogus", "modules/catalog/server/server.js", {
    CATALOG_PORT: String(ports.catalog),
    CATALOG_DB_PATH: path.join(WORK, "show", "catalog.sqlite"),
    CATALOG_MEDIA_ROOT: path.join(WORK, "show", "media"),
    CATALOG_SHOW_CONTROL_URL: "http://127.0.0.1:9",
  });
  const showPathsProcess = start("show-paden", "modules/paths/server/server.js", {
    PATHS_PORT: String(ports.paths),
    PATHS_STORE_PATH: path.join(WORK, "show", "paths-store.json"),
    PATHS_CATALOG_URL: showCatalog,
  });

  // Stand-in for the runtime (the test decides whether a run is busy) and for Show
  // Control (it notes which environments it is asked to reload).
  let run = { status: "running", activeSituation: null, finalizationStatus: { status: "idle" }, updatedAt: new Date().toISOString() };
  const refreshed = [];
  const runtime = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/v0/show-control/media-assets/refresh") {
      let text = "";
      req.on("data", (chunk) => { text += chunk; });
      req.on("end", () => {
        refreshed.push(JSON.parse(text || "{}").environmentId);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.end(JSON.stringify(run));
  });
  await new Promise((resolve) => runtime.listen(ports.runtime, "127.0.0.1", resolve));

  await waitFor(`${nasUrl}/sync/v1/stand`, nas);
  await waitFor(`${showCatalog}/health`, showCatalogProcess);
  await waitFor(`${showPaths}/health`, showPathsProcess);

  let clock = Date.now();
  const agentLog = [];
  const agent = createAgent({
    websiteUrl: nasUrl,
    syncSecret: SECRET,
    catalogUrl: showCatalog,
    pathsUrl: showPaths,
    runtimeUrl: `http://127.0.0.1:${ports.runtime}`,
    quietMinutes: 15,
    dataDir: path.join(WORK, "agent"),
    catalogDbPath: path.join(WORK, "show", "catalog.sqlite"),
    mediaRoot: path.join(WORK, "show", "media"),
    showControlUrl: `http://127.0.0.1:${ports.runtime}`,
    now: () => clock,
    log: (line) => agentLog.push(line),
  });

  const site = (method, url, { user = "anna@test.nl", basis, body } = {}) => call(`${nasUrl}${url}`, {
    method,
    headers: { "x-test-user": user, ...(basis ? { "x-foryou-basis": String(basis) } : {}) },
    body,
  });
  const showContent = async () => {
    const [catalog, paths] = await Promise.all([call(`${showCatalog}/v0/catalog/content`), call(`${showPaths}/v0/paths/store`)]);
    return { catalog: catalog.json.content, paths: paths.json.content, hashes: { catalog: catalog.json.hash, paths: paths.json.hash } };
  };
  const stand = async () => (await site("GET", "/api/stand")).json;
  const situationBody = (s, change = {}) => ({ title: s.title, description: s.description, environmentId: s.environmentId || "", characterIds: s.characterIds, ...change });
  const situations = async () => (await site("GET", "/v0/catalog/read-model")).json.situations;
  const situation = async (id) => (await situations()).find((item) => item.id === id);
  const showSituation = async (id) => (await call(`${showCatalog}/v0/catalog/read-model`)).json.situations.find((item) => item.id === id);

  // Situations to edit in the scenarios; the numbering has gaps, so take real ones.
  const S = { 2: "situation:2" };
  const activeIds = (await situations()).filter((item) => item.active !== false && item.id !== "situation:2").map((item) => item.id);
  for (let n = 3; n <= 10; n += 1) S[n] = activeIds[n - 3];

  const steps = [
    scenario("beginstand: website-versie 1 is precies de inhoud van de show-Mac", async () => {
      const s = await stand();
      assert.equal(s.head.nr, 1);
      assert.equal(s.released.nr, 1);
      const local = await showContent();
      assert.deepEqual(s.head.hashes, local.hashes);
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      assert.equal(report.appliedVersion, 1);
      assert.equal((await stand()).showMac.appliedVersion, 1);
    }),

    scenario("zonder login of met verkeerd geheim: geen toegang", async () => {
      assert.equal((await call(`${nasUrl}/api/stand`)).status, 401);
      assert.equal((await call(`${nasUrl}/sync/v1/stand`)).status, 401);
      assert.equal((await call(`${nasUrl}/sync/v1/stand`, { headers: { authorization: "Bearer fout" } })).status, 401);
      // A team login that is not for the show (the build iPad) gets nothing, not even a page.
      assert.equal((await site("GET", "/api/stand", { user: "Bouw@Test.nl" })).status, 403);
      assert.equal((await site("GET", "/catalog/", { user: "bouw@test.nl" })).status, 403);
    }),

    scenario("bewerken op de website maakt een versie; de schermen krijgen het balk-script", async () => {
      const page = await site("GET", "/catalog/");
      assert.equal(page.status, 200);
      assert.match(page.text, /\/_editor\/balk\.js/);
      const read = await site("GET", "/v0/catalog/read-model");
      assert.equal(read.headers.get("x-foryou-versie"), "1");
      const s2 = read.json.situations.find((item) => item.id === "situation:2");
      const saved = await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[2])}`, { basis: 1, body: situationBody(s2, { title: `${s2.title} (website)` }) });
      assert.equal(saved.status, 200, saved.text);
      assert.equal(saved.headers.get("x-foryou-versie"), "2");
      const s = await stand();
      assert.equal(s.head.nr, 2);
      assert.equal(s.released.nr, 1, "zonder vrijgeven gaat niets naar de show");
      assert.deepEqual(s.head.changes.map((change) => change.key), ["situation:2"]);
      assert.equal(s.head.author, "anna@test.nl");
      const after = await situation("situation:2");
      assert.deepEqual(after.labelIds, s2.labelIds, "labels blijven staan");
      assert.equal(after.characterSlots.length, s2.characterSlots.length, "lege plek blijft staan");
    }),

    scenario("botsing: een verouderde pagina overschrijft andermans wijziging niet", async () => {
      const s2 = await situation("situation:2");
      const stale = await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[2])}`, { user: "bram@test.nl", basis: 1, body: situationBody(s2, { title: "Bram overschrijft" }) });
      assert.equal(stale.status, 409);
      assert.match(stale.json.message, /anna@test\.nl/);
      assert.equal((await situation("situation:2")).title, s2.title);
      const s3 = await situation(S[3]);
      const other = await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[3])}`, { user: "bram@test.nl", basis: 1, body: situationBody(s3, { title: `${s3.title} (Bram)` }) });
      assert.equal(other.status, 200, "een ander record mag wel");
      const noBasis = await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[3])}`, { user: "bram@test.nl", body: situationBody(s3) });
      assert.equal(noBasis.status, 428);
    }),

    scenario("lichtstanden, momentopnames en ruwe inhoud kunnen niet via de website", async () => {
      assert.equal((await site("PUT", "/v0/catalog/lighting-presets/x", { body: {} })).status, 403);
      assert.equal((await site("POST", "/v0/catalog/snapshots", { body: {} })).status, 403);
      assert.equal((await site("GET", "/v0/catalog/content")).status, 403);
      assert.equal((await site("GET", "/v0/catalog/media-files")).status, 403);
      assert.equal((await site("PUT", "/v0/paths/store", { body: {} })).status, 403);
      assert.equal((await call(`${showCatalog}/v0/catalog/content`, { method: "PUT", body: {} })).status, 409, "lokaal wel, maar alleen met de juiste vingerafdruk");
    }),

    scenario("tien gelijktijdige opslagen: niets gaat verloren", async () => {
      const head = (await stand()).head.nr;
      const list = (await situations()).filter((item) => item.active !== false).slice(10, 20);
      const saves = await Promise.all(list.map((item, index) => site("PATCH", `/v0/catalog/situations/${encodeURIComponent(item.id)}`, {
        user: `persoon${index}@test.nl`,
        basis: head,
        body: situationBody(item, { description: `${item.description || ""} [gelijktijdig ${index}]` }),
      })));
      assert.deepEqual(saves.map((save) => save.status), list.map(() => 200));
      const now = await situations();
      list.forEach((item, index) => assert.match(now.find((x) => x.id === item.id).description, new RegExp(`\\[gelijktijdig ${index}\\]`)));
      assert.equal((await stand()).head.nr, head + 10);
    }),

    scenario("vrijgeven: de show-Mac wacht zolang er een situatie speelt", async () => {
      const head = (await stand()).head.nr;
      assert.equal((await site("POST", "/api/vrijgeven", { body: { nr: head } })).status, 200);
      const before = await showContent();
      run = { ...run, activeSituation: { situationId: S[5] }, updatedAt: new Date(clock).toISOString() };
      const waiting = await agent.tick();
      assert.equal(waiting.state, "wacht", JSON.stringify(waiting));
      assert.match(waiting.message, /speelt een situatie/);
      assert.deepEqual((await showContent()).hashes, before.hashes, "niets veranderd");
      run = { ...run, activeSituation: null, updatedAt: new Date(clock).toISOString() };
      const quiet = await agent.tick();
      assert.equal(quiet.state, "wacht", "run was net actief");
      assert.deepEqual((await showContent()).hashes, before.hashes);
    }),

    scenario("na een stil kwartier staat de versie in de show, met backup", async () => {
      clock += 16 * 60 * 1000;
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      const s = await stand();
      assert.equal(report.appliedVersion, s.released.nr);
      assert.deepEqual((await showContent()).hashes, s.released.hashes);
      assert.match((await showSituation("situation:2")).title, /\(website\)$/);
      assert.ok(fs.readdirSync(path.join(WORK, "agent", "backups")).some((name) => name.includes(`voor-v${s.released.nr}`)));
    }),

    scenario("na een reset gaat een nieuwe versie er meteen in", async () => {
      const s4 = await situation(S[4]);
      const head = (await stand()).head.nr;
      const saved = await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[4])}`, { basis: head, body: situationBody(s4, { title: `${s4.title} (na reset)` }) });
      assert.equal(saved.status, 200);
      await site("POST", "/api/vrijgeven", { body: { nr: head + 1 } });
      run = { status: "reset", activeSituation: null, finalizationStatus: { status: "idle" }, updatedAt: new Date(clock).toISOString() };
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      assert.equal(report.appliedVersion, head + 1);
    }),

    scenario("website onbereikbaar: de show houdt zijn versie en meldt offline", async () => {
      const before = await showContent();
      await stop(nas);
      const report = await agent.tick();
      assert.equal(report.state, "offline", JSON.stringify(report));
      assert.deepEqual((await showContent()).hashes, before.hashes);
      const status = JSON.parse(fs.readFileSync(path.join(WORK, "agent", "status.json"), "utf8"));
      assert.equal(status.state, "offline");
      nas = start("editor", "editor/server/server.js", nasEnv);
      await waitFor(`${nasUrl}/sync/v1/stand`, nas);
      const headBefore = (await stand()).head.nr;
      assert.equal((await agent.tick()).state, "bijgewerkt");
      assert.equal((await stand()).head.nr, headBefore, "herstart maakt geen nieuwe versie");
    }),

    scenario("een geplande wijziging terwijl de editor uit stond: de versie krijgt de reden uit herstart-reden.json", async () => {
      const headBefore = (await stand()).head.nr;
      await stop(nas);
      const storePath = path.join(WORK, "nas", "paths-store.json");
      const pathsStore = JSON.parse(fs.readFileSync(storePath, "utf8"));
      pathsStore.paths[0].description = `${pathsStore.paths[0].description || ""} (bijgewerkt terwijl de editor uit stond)`;
      fs.writeFileSync(storePath, JSON.stringify(pathsStore, null, 2));
      const reasonFile = path.join(WORK, "nas", "herstart-reden.json");
      fs.writeFileSync(reasonFile, JSON.stringify({ reason: "Fases: voorstellen uit het onderzoek", author: "fases-sessie" }));
      nas = start("editor", "editor/server/server.js", nasEnv);
      await waitFor(`${nasUrl}/sync/v1/stand`, nas);
      const head = (await stand()).head;
      assert.equal(head.nr, headBefore + 1);
      assert.equal(head.reason, "Fases: voorstellen uit het onderzoek");
      assert.equal(head.author, "fases-sessie");
      assert.equal(fs.existsSync(reasonFile), false, "de reden wordt één keer gebruikt");
    }),

    scenario("een beschadigde versie wordt geweigerd; niets veranderd", async () => {
      const s5 = await situation(S[5]);
      const head = (await stand()).head.nr;
      await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[5])}`, { basis: head, body: situationBody(s5, { title: `${s5.title} (versie ${head + 1})` }) });
      const file = path.join(WORK, "nas", "versies", `v${String(head + 1).padStart(6, "0")}.json`);
      const original = fs.readFileSync(file, "utf8");
      const tampered = JSON.parse(original);
      tampered.catalog.situations.find((item) => item.id === S[5]).title = "Ingeslopen";
      fs.writeFileSync(file, JSON.stringify(tampered));
      await site("POST", "/api/vrijgeven", { body: { nr: head + 1 } });
      const before = await showContent();
      const report = await agent.tick();
      assert.equal(report.state, "fout");
      assert.match(report.message, /niet ongeschonden/);
      assert.deepEqual((await showContent()).hashes, before.hashes);
      fs.writeFileSync(file, original);
      assert.equal((await agent.tick()).state, "bijgewerkt");
    }),

    scenario("een versie met fouten kan niet worden vrijgegeven", async () => {
      const head = (await stand()).head.nr;
      const file = path.join(WORK, "nas", "versies", `v${String(head).padStart(6, "0")}.json`);
      const original = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), validation: { ok: false } }));
      const refused = await site("POST", "/api/vrijgeven", { body: { nr: head } });
      assert.equal(refused.status, 409);
      fs.writeFileSync(file, original);
    }),

    scenario("bewerken op de show-Mac zelf wordt de volgende versie op de website", async () => {
      const local = await showSituation(S[6]);
      const saved = await call(`${showCatalog}/v0/catalog/situations/${encodeURIComponent(S[6])}`, { method: "PATCH", body: situationBody(local, { title: `${local.title} (show-Mac)` }) });
      assert.equal(saved.status, 200);
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      const s = await stand();
      assert.equal(s.head.author, "show-Mac");
      assert.equal(s.released.nr, s.head.nr);
      assert.match((await situation(S[6])).title, /\(show-Mac\)$/);
    }),

    scenario("allebei gewijzigd: niets overschreven tot iemand kiest", async () => {
      const head = (await stand()).head.nr;
      const s7 = await situation(S[7]);
      await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[7])}`, { basis: head, body: situationBody(s7, { title: `${s7.title} (website)` }) });
      await site("POST", "/api/vrijgeven", { body: { nr: head + 1 } });
      const local = await showSituation(S[8]);
      await call(`${showCatalog}/v0/catalog/situations/${encodeURIComponent(S[8])}`, { method: "PATCH", body: situationBody(local, { title: `${local.title} (lokaal)` }) });
      const localContent = await showContent();
      const report = await agent.tick();
      assert.equal(report.state, "conflict", JSON.stringify(report));
      assert.deepEqual((await showContent()).hashes, localContent.hashes, "lokale wijziging blijft staan");
      assert.equal((await agent.tick()).state, "conflict", "blijft wachten, stuurt niet opnieuw");
      const s = await stand();
      assert.ok(s.conflict);
      assert.deepEqual(s.conflict.changes.map((change) => change.key), [S[8]]);
      assert.ok(fs.readdirSync(path.join(WORK, "agent", "backups")).some((name) => name.includes("eigen-wijzigingen")));
      assert.ok(fs.existsSync(path.join(WORK, "nas", "voorstellen", `${s.conflict.id}.json`)));
      const chosen = await site("POST", "/api/conflict/kies", { body: { id: s.conflict.id, keuze: "website" } });
      assert.equal(chosen.status, 200);
      const after = await agent.tick();
      assert.equal(after.state, "bijgewerkt", JSON.stringify(after));
      assert.deepEqual((await showContent()).hashes, (await stand()).released.hashes);
      assert.match((await showSituation(S[7])).title, /\(website\)$/);
    }),

    scenario("allebei gewijzigd, show-Mac gekozen: website neemt het over", async () => {
      const head = (await stand()).head.nr;
      const s9 = await situation(S[9]);
      await site("PATCH", `/v0/catalog/situations/${encodeURIComponent(S[9])}`, { basis: head, body: situationBody(s9, { title: `${s9.title} (website)` }) });
      const local = await showSituation(S[10]);
      await call(`${showCatalog}/v0/catalog/situations/${encodeURIComponent(S[10])}`, { method: "PATCH", body: situationBody(local, { title: `${local.title} (lokaal)` }) });
      assert.equal((await agent.tick()).state, "conflict");
      const s = await stand();
      assert.equal((await site("POST", "/api/conflict/kies", { body: { id: s.conflict.id, keuze: "show-mac" } })).status, 200);
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      assert.match((await situation(S[10])).title, /\(lokaal\)$/);
      assert.deepEqual((await showContent()).hashes, (await stand()).released.hashes);
    }),

    scenario("afgebroken zetten (stroom weg): de backup komt terug", async () => {
      const before = await showContent();
      const state = agent.readState();
      const backupFile = path.join(WORK, "agent", "backups", "handmatig.json");
      fs.writeFileSync(backupFile, JSON.stringify(before));
      const half = JSON.parse(JSON.stringify(before.catalog));
      half.situations[0].title = "Half gezet";
      await call(`${showCatalog}/v0/catalog/content`, { method: "PUT", body: { content: half, expectedHash: before.hashes.catalog } });
      fs.writeFileSync(path.join(WORK, "agent", "staat.json"), JSON.stringify({ ...state, applying: { nr: 999, hashes: { catalog: "x", paths: "y" }, backupFile, backupHashes: before.hashes } }));
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      assert.deepEqual((await showContent()).hashes, before.hashes);
      assert.equal(agent.readState().applying, null);
    }),

    scenario("terugzetten maakt een nieuwe versie met de oude inhoud", async () => {
      const s = await stand();
      const restored = await site("POST", "/api/terugzetten", { body: { nr: 1 } });
      assert.equal(restored.status, 200, restored.text);
      const after = await stand();
      assert.equal(after.head.nr, s.head.nr + 1);
      const first = (await call(`${nasUrl}/sync/v1/versies/1`, { headers: { authorization: `Bearer ${SECRET}` } })).json.version;
      assert.deepEqual(after.head.hashes, first.hashes);
      assert.equal((await situation("situation:2")).title, first.catalog.situations.find((x) => x.id === "situation:2").title);
    }),

    scenario("nieuwe situatie op de website kan in een pad en komt in de show", async () => {
      const s = await stand();
      const base = await situation("situation:2");
      const created = await site("POST", "/v0/catalog/situations", { basis: s.head.nr, body: { title: "Nieuwe situatie website", description: "x", environmentId: base.environmentId, characterIds: base.characterIds.slice(0, 1) } });
      assert.equal(created.status, 201, created.text);
      const legacyId = created.json.situation.legacyId;
      const editorState = await site("GET", "/v0/paths/editor-state");
      assert.ok(editorState.json.catalog.scenes.some((scene) => scene.id === legacyId));
      const madePath = await site("POST", "/v0/paths/paths/upsert", { basis: Number(editorState.headers.get("x-foryou-versie")), body: { name: "Pad met nieuwe situatie", sceneIds: [2, legacyId], edges: [{ fromSceneId: 2, toSceneId: legacyId }] } });
      assert.ok(madePath.status === 201 || madePath.status === 200, madePath.text);
      const head = (await stand()).head;
      assert.ok(head.changes.some((change) => change.collection === "paths"));
      assert.equal((await site("POST", "/api/vrijgeven", { body: { nr: head.nr } })).status, 200);
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      const local = await showContent();
      assert.ok(local.catalog.situations.some((item) => item.legacyId === legacyId));
      assert.ok(local.paths.paths.some((item) => item.sceneIds.includes(legacyId)));
    }),

    scenario("tien gelijktijdige opslagen op de show-Mac zelf: de schrijfrij verliest niets, de website krijgt ze", async () => {
      const list = (await call(`${showCatalog}/v0/catalog/read-model`)).json.situations.filter((item) => item.active !== false).slice(20, 30);
      const saves = await Promise.all(list.map((item, index) => call(`${showCatalog}/v0/catalog/situations/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: situationBody(item, { description: `${item.description || ""} [lokaal ${index}]` }),
      })));
      assert.deepEqual(saves.map((save) => save.status), list.map(() => 200));
      const local = (await call(`${showCatalog}/v0/catalog/read-model`)).json.situations;
      list.forEach((item, index) => assert.match(local.find((x) => x.id === item.id).description, new RegExp(`\\[lokaal ${index}\\]`)));
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      const head = (await stand()).head;
      assert.equal(head.author, "show-Mac");
      assert.equal(head.changes.length, 10);
    }),

    // ---- The image catalog ----
    scenario("beeldcatalogus op de website: de pagina en de bestanden komen door", async () => {
      const page = await site("GET", "/catalog/media-assets/");
      assert.equal(page.status, 200);
      assert.match(page.text, /\/_editor\/balk\.js/);
      assert.match(page.text, /src="\/catalog\/media-assets\/app\.js\?v=[0-9a-f]{10}"/, "een nieuwe uitrol komt meteen door");
      const overview = await site("GET", "/v0/catalog/media-assets");
      assert.equal(overview.status, 200);
      assert.ok(overview.headers.get("x-foryou-versie"));
      const asset = overview.json.storedMediaAssets.find((item) => item.status === "present" && item.relativePath);
      const file = await fetch(`${nasUrl}/v0/catalog/media-assets/file/${encodeURIComponent(asset.id)}`, { headers: { "x-test-user": "anna@test.nl" } });
      assert.equal(file.status, 200);
      const bytes = Buffer.from(await file.arrayBuffer());
      assert.equal(sha256(bytes), sha256(fs.readFileSync(path.join(WORK, "show", "media", asset.relativePath))));
      assert.ok((await stand()).head.media[asset.relativePath], "elke versie weet welk bestand bij elk record hoort");
      assert.equal(file.headers.get("cache-control"), "private, max-age=31536000, immutable", "het id bevat de inhoudshash");

      // The overview gets a small preview of a picture, and the original of anything else.
      const as = { headers: { "x-test-user": "anna@test.nl" }, redirect: "manual" };
      const image = overview.json.storedMediaAssets.find((item) => item.status === "present" && /^image\//.test(item.mimeType || ""));
      const preview = await fetch(`${nasUrl}/v0/catalog/media-assets/voorbeeld/${encodeURIComponent(image.id)}`, as);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("content-type"), "image/webp");
      assert.equal(preview.headers.get("cache-control"), "private, max-age=31536000, immutable");
      assert.ok((await preview.arrayBuffer()).byteLength > 0);
      const sound = overview.json.storedMediaAssets.find((item) => item.status === "present" && /^audio\//.test(item.mimeType || ""));
      const original = await fetch(`${nasUrl}/v0/catalog/media-assets/voorbeeld/${encodeURIComponent(sound.id)}`, as);
      assert.equal(original.status, 302);
      assert.equal(original.headers.get("location"), `/v0/catalog/media-assets/file/${encodeURIComponent(sound.id)}`);
      assert.equal((await fetch(`${nasUrl}/v0/catalog/media-assets/voorbeeld/${encodeURIComponent(image.id)}`, { redirect: "manual" })).status, 401);

      // A browser that stops halfway (another page, a jump in a video) does not take the editor down.
      const big = overview.json.storedMediaAssets.filter((item) => item.status === "present").sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))[0];
      const bigUrl = `${nasUrl}/v0/catalog/media-assets/file/${encodeURIComponent(big.id)}`;
      await Promise.all(Array.from({ length: 24 }, async (_, i) => {
        const stop = new AbortController();
        const headers = { "x-test-user": "anna@test.nl", ...(i % 3 === 2 ? { range: "bytes=1000-" } : {}) };
        if (i % 3 === 0) setTimeout(() => stop.abort(), i % 2);
        try {
          const response = await fetch(bigUrl, { headers, signal: stop.signal });
          await response.body.getReader().read();
          stop.abort();
        } catch (_err) {
          // Stopped on purpose.
        }
      }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal((await site("GET", "/api/stand")).status, 200, "de editor draait nog");
    }),

    // ---- Ideas ----
    scenario("ideeën: eigen pagina en opslag, alleen je eigen idee aanpassen, nooit een versie", async () => {
      const before = (await stand()).head.nr;
      const page = await site("GET", "/ideeen/");
      assert.equal(page.status, 200);
      assert.match(page.text, /src="ideeen\.js\?v=[0-9a-f]{10}"/);
      assert.equal((await site("GET", "/ideeen/", { user: "bouw@test.nl" })).status, 403);
      const made = await site("POST", "/api/ideeen", { body: { soort: "personage", tekst: "Een buschauffeur die alles weet" } });
      assert.equal(made.status, 200, made.text);
      const id = made.json.idee.id;
      assert.equal((await site("PATCH", `/api/ideeen/${id}`, { user: "bert@test.nl", body: { tekst: "iets anders" } })).status, 403);
      assert.equal((await site("PUT", `/api/ideeen/${id}/status`, { user: "bert@test.nl", body: { status: "besproken" } })).status, 200);
      assert.equal((await site("POST", `/api/ideeen/${id}/reacties`, { user: "bert@test.nl", body: { tekst: "Mooi" } })).status, 200);
      const seen = (await site("GET", "/api/ideeen", { user: "bert@test.nl" })).json.ideeen.find((item) => item.id === id);
      assert.deepEqual([seen.naam, seen.eigen, seen.status, seen.reacties[0].naam], ["anna", false, "besproken", "bert"]);
      const put = await fetch(`${nasUrl}/api/ideeen/${id}/foto`, { method: "PUT", headers: { "x-test-user": "anna@test.nl", "content-type": "image/png" }, body: tinyPng("idee") });
      assert.equal(put.status, 200);
      const photo = await fetch(`${nasUrl}/ideeen/foto/${(await put.json()).idee.foto.klein}`, { headers: { "x-test-user": "bert@test.nl" } });
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get("content-type"), "image/webp");
      assert.equal(photo.headers.get("cache-control"), "private, max-age=31536000, immutable");
      assert.equal((await stand()).head.nr, before, "een idee is geen versie en gaat niet naar de show");
    }),

    scenario("nieuw beeld + compositie op de website: de show-Mac haalt het bestand op en zet alles erin", async () => {
      const environmentId = "environment:10";
      const s = await stand();
      const form = new FormData();
      form.set("environmentId", environmentId);
      form.set("type", "background");
      form.set("role", "background");
      form.set("tags", "background");
      const png = tinyPng("website-1");
      form.set("asset", new Blob([png], { type: "image/png" }), "nieuwe-achtergrond.png");
      const uploaded = await fetch(`${nasUrl}/v0/catalog/media-assets/upload`, { method: "POST", headers: { "x-test-user": "anna@test.nl", "x-foryou-basis": String(s.head.nr) }, body: form });
      const upload = await uploaded.json();
      assert.equal(uploaded.status, 201, JSON.stringify(upload));
      const afterUpload = (await stand()).head;
      assert.match(afterUpload.reason, /^Achtergrond toegevoegd bij /);
      assert.equal(afterUpload.media[upload.asset.relativePath].sha256, sha256(png));

      const overview = (await site("GET", "/v0/catalog/media-assets")).json;
      const composition = overview.environmentCompositions.find((item) => item.environmentId === environmentId);
      const body = {
        ...composition,
        backgroundLayer: { ...composition.backgroundLayer, id: "layer:background:test", assetId: upload.asset.id, name: "nieuwe-achtergrond.png" },
      };
      const saved = await site("PUT", `/v0/catalog/media-compositions/${encodeURIComponent(environmentId)}`, { basis: afterUpload.nr, body });
      assert.equal(saved.status, 200, saved.text);
      const head = (await stand()).head;
      assert.match(head.reason, /^Compositie aangepast: /);
      assert.ok(head.changes.some((change) => change.key === `composition:${environmentId}`));

      const stale = await site("PUT", `/v0/catalog/media-compositions/${encodeURIComponent(environmentId)}`, { user: "bram@test.nl", basis: afterUpload.nr, body });
      assert.equal(stale.status, 409, "een verouderde compositie overschrijft niets");

      assert.equal((await site("POST", "/api/vrijgeven", { body: { nr: head.nr } })).status, 200);
      run = { ...run, status: "idle" };
      refreshed.length = 0;
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      const local = await showContent();
      assert.deepEqual(local.hashes, head.hashes);
      const localFile = path.join(WORK, "show", "media", upload.asset.relativePath);
      assert.equal(sha256(fs.readFileSync(localFile)), sha256(png), "het bestand staat ongeschonden op de show-Mac");
      const localAsset = local.catalog.mediaAssets.find((item) => item.id === upload.asset.id);
      assert.ok(localAsset);
      assert.equal(localAsset.filePath, undefined, "machinepaden reizen niet mee");
      const localComposition = local.catalog.environmentCompositions.find((item) => item.environmentId === environmentId);
      assert.equal(localComposition.backgroundLayer.assetId, upload.asset.id);
      const served = await fetch(`${showCatalog}/v0/catalog/media-assets/file/${encodeURIComponent(upload.asset.id)}`);
      assert.equal(served.status, 200, "de show-Mac vindt het bestand via zijn eigen pad");
      assert.ok(refreshed.includes(environmentId), "Show Control krijgt het seintje om opnieuw te laden");
    }),

    scenario("een bestand dat beschadigd binnenkomt wordt geweigerd; niets veranderd", async () => {
      const s = await stand();
      const form = new FormData();
      form.set("environmentId", "environment:10");
      form.set("type", "fx");
      form.set("role", "fxImage");
      form.set("tags", "fx,image");
      const png = tinyPng("website-2");
      form.set("asset", new Blob([png], { type: "image/png" }), "effect.png");
      const uploaded = await fetch(`${nasUrl}/v0/catalog/media-assets/upload`, { method: "POST", headers: { "x-test-user": "anna@test.nl", "x-foryou-basis": String(s.head.nr) }, body: form });
      const upload = await uploaded.json();
      assert.equal(uploaded.status, 201, JSON.stringify(upload));
      const head = (await stand()).head;
      const nasFile = path.join(WORK, "nas", "media", upload.asset.relativePath);
      fs.writeFileSync(nasFile, Buffer.concat([png, Buffer.from("kapot")]));
      assert.equal((await site("POST", "/api/vrijgeven", { body: { nr: head.nr } })).status, 200);
      const before = await showContent();
      const report = await agent.tick();
      assert.equal(report.state, "fout", JSON.stringify(report));
      assert.match(report.message, /niet ongeschonden/);
      assert.deepEqual((await showContent()).hashes, before.hashes, "niets veranderd");
      assert.equal(fs.existsSync(path.join(WORK, "show", "media", upload.asset.relativePath)), false, "het kapotte bestand is niet neergezet");
      fs.writeFileSync(nasFile, png);
      const again = await agent.tick();
      assert.equal(again.state, "bijgewerkt", JSON.stringify(again));
      assert.deepEqual((await showContent()).hashes, head.hashes);
    }),

    scenario("nieuw beeld op de show-Mac zelf: bestand en inhoud gaan naar de website", async () => {
      const form = new FormData();
      form.set("environmentId", "environment:10");
      form.set("type", "fx");
      form.set("role", "fxImage");
      form.set("tags", "fx,image");
      const png = tinyPng("show-mac-1");
      form.set("asset", new Blob([png], { type: "image/png" }), "lokaal.png");
      const uploaded = await fetch(`${showCatalog}/v0/catalog/media-assets/upload`, { method: "POST", body: form });
      const upload = await uploaded.json();
      assert.equal(uploaded.status, 201, JSON.stringify(upload));
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      const head = (await stand()).head;
      assert.equal(head.author, "show-Mac");
      assert.equal(head.media[upload.asset.relativePath].sha256, sha256(png));
      assert.equal(sha256(fs.readFileSync(path.join(WORK, "nas", "media", upload.asset.relativePath))), sha256(png));
    }),

    scenario("media verwijderen op de website: het record gaat mee, het bestand op de show-Mac blijft", async () => {
      const s = await stand();
      const overview = (await site("GET", "/v0/catalog/media-assets")).json;
      const asset = overview.storedMediaAssets.find((item) => item.originalFilename === "lokaal.png" && item.status !== "deleted");
      const removed = await site("DELETE", `/v0/catalog/media-assets/${encodeURIComponent(asset.id)}`, { basis: s.head.nr });
      assert.equal(removed.status, 200, removed.text);
      const head = (await stand()).head;
      assert.match(head.reason, /verwijderd/);
      assert.equal((await site("POST", "/api/vrijgeven", { body: { nr: head.nr } })).status, 200);
      const report = await agent.tick();
      assert.equal(report.state, "bijgewerkt", JSON.stringify(report));
      const local = await showContent();
      assert.equal(local.catalog.mediaAssets.find((item) => item.id === asset.id).status, "deleted");
      assert.ok(fs.existsSync(path.join(WORK, "show", "media", asset.relativePath)), "de sync verwijdert nooit een bestand");
    }),
  ];

  for (const step of steps) await step();
  process.stdout.write(`\nsync-integratie: ${results.length} scenario's OK\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`${err.stack || err}\n`);
    for (const child of children) if (child.output) process.stderr.write(`--- ${child.label}\n${child.output.slice(-3000)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(children.map(stop));
    if (!process.env.FORYOU_TEST_KEEP) fs.rmSync(WORK, { recursive: true, force: true });
    process.exit();
  });
