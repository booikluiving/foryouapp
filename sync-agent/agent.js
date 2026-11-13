"use strict";

// Runs on the show Mac. Picks up the version released on the website and puts it into
// the local catalog and paths services, only at a quiet moment, with a backup, a
// check afterwards and an automatic way back. Without the website the show simply
// keeps the last version it has. Local edits are never overwritten without a decision
// on the website.

const fs = require("node:fs");
const path = require("node:path");

const { catalogContentHash, mediaFilesFor, withCatalogContent } = require("../modules/catalog/write-model/catalog-content");
const { pathsContentHash, withPathsContent } = require("../modules/paths/db/paths-content");

const APP_ROOT = path.resolve(__dirname, "..");
const MAX_BACKUPS = 40;

function sameHashes(left, right) {
  return Boolean(left && right && left.catalog === right.catalog && left.paths === right.paths);
}

function writeFileAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(temp, "w");
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, filePath);
}

class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function requestJson(url, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_err) {
    parsed = null;
  }
  if (!response.ok) {
    throw new HttpError((parsed && (parsed.message || parsed.error)) || `HTTP ${response.status}`, response.status, parsed);
  }
  if (!parsed) throw new HttpError("geen JSON-antwoord", response.status, null);
  return parsed;
}

// Streams one file from `from` to `to` (a PUT); the receiving catalog checks the SHA-256.
async function transferFile(from, to) {
  const source = await fetch(from.url, { headers: from.headers || {}, signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!source.ok || !source.body) {
    const err = new HttpError(`bestand ophalen gaf HTTP ${source.status}`, source.status, null);
    err.fromWebsite = Boolean(from.website);
    throw err;
  }
  const target = await fetch(to.url, {
    method: "PUT",
    headers: { ...(to.headers || {}), "content-type": "application/octet-stream" },
    body: source.body,
    duplex: "half",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const text = await target.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_err) {
    parsed = null;
  }
  if (!target.ok) {
    const err = new HttpError((parsed && (parsed.message || parsed.error)) || `HTTP ${target.status}`, target.status, parsed);
    err.fromWebsite = Boolean(to.website);
    throw err;
  }
  return parsed;
}

// The environments whose media or composition differ between two catalogs.
function changedMediaEnvironments(before, after) {
  const byKey = (catalog) => {
    const map = new Map();
    for (const asset of (catalog && catalog.mediaAssets) || []) map.set(`a:${asset.id}`, asset);
    for (const composition of (catalog && catalog.environmentCompositions) || []) map.set(`c:${composition.environmentId}`, composition);
    return map;
  };
  const left = byKey(before);
  const right = byKey(after);
  const environments = new Set();
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key);
    const b = right.get(key);
    if (JSON.stringify(a) !== JSON.stringify(b)) environments.add((b || a).environmentId);
  }
  environments.delete(undefined);
  return [...environments];
}

function createAgent(config) {
  const dataDir = path.resolve(config.dataDir || path.join(APP_ROOT, "sync-agent", "data"));
  const statePath = path.join(dataDir, "staat.json");
  const statusPath = path.join(dataDir, "status.json");
  const backupsDir = path.join(dataDir, "backups");
  const scratchRoot = path.join(APP_ROOT, "sync-agent", "data", "controle");
  const quietMs = Math.max(0, Number(config.quietMinutes == null ? 15 : config.quietMinutes)) * 60 * 1000;
  const now = config.now || (() => Date.now());
  const log = config.log || ((line) => process.stdout.write(`${new Date(now()).toISOString()} ${line}\n`));

  function websiteHeaders() {
    const headers = { authorization: `Bearer ${config.syncSecret}` };
    if (config.accessClientId) headers["cf-access-client-id"] = config.accessClientId;
    if (config.accessClientSecret) headers["cf-access-client-secret"] = config.accessClientSecret;
    return headers;
  }

  // Errors from the website are marked, so "website out of reach" is never mistaken
  // for a problem on this machine.
  const fromWebsite = (promise) => promise.catch((err) => {
    err.fromWebsite = true;
    throw err;
  });
  const website = {
    stand: () => fromWebsite(requestJson(`${config.websiteUrl}/sync/v1/stand`, { headers: websiteHeaders() })),
    version: (nr) => fromWebsite(requestJson(`${config.websiteUrl}/sync/v1/versies/${nr}`, { headers: websiteHeaders(), timeoutMs: 60000 })),
    find: (hashes) => fromWebsite(requestJson(`${config.websiteUrl}/sync/v1/zoek?catalog=${hashes.catalog}&paths=${hashes.paths}`, { headers: websiteHeaders() })),
    upload: (body) => fromWebsite(requestJson(`${config.websiteUrl}/sync/v1/upload`, { method: "POST", headers: websiteHeaders(), body, timeoutMs: 60000 })),
    report: (body) => fromWebsite(requestJson(`${config.websiteUrl}/sync/v1/melding`, { method: "POST", headers: websiteHeaders(), body })),
    mediaMissing: (files) => fromWebsite(requestJson(`${config.websiteUrl}/sync/v1/media/ontbrekend`, { method: "POST", headers: websiteHeaders(), body: { files }, timeoutMs: 120000 })),
    mediaUrl: (relativePath, sha256) => `${config.websiteUrl}/sync/v1/media?pad=${encodeURIComponent(relativePath)}${sha256 ? `&sha256=${sha256}` : ""}`,
    schrijver: () => fromWebsite(requestJson(`${config.websiteUrl}/sync/v1/schrijver`, { headers: websiteHeaders() })),
  };
  const scriptAgentUrl = String(config.scriptAgentUrl || "http://127.0.0.1:3027").replace(/\/+$/, "");

  const local = {
    async content() {
      const [catalog, paths] = await Promise.all([
        requestJson(`${config.catalogUrl}/v0/catalog/content`),
        requestJson(`${config.pathsUrl}/v0/paths/store`),
      ]);
      return { catalog: catalog.content, paths: paths.content, hashes: { catalog: catalog.hash, paths: paths.hash } };
    },
    putCatalog: (content, expectedHash, force = false) => requestJson(`${config.catalogUrl}/v0/catalog/content`, { method: "PUT", body: { content, expectedHash, force }, timeoutMs: 60000 }),
    putPaths: (content, expectedHash, force = false) => requestJson(`${config.pathsUrl}/v0/paths/store`, { method: "PUT", body: { content, expectedHash, force }, timeoutMs: 60000 }),
    validation: () => requestJson(`${config.catalogUrl}/v0/catalog/validation`),
    pathsValidation: () => requestJson(`${config.pathsUrl}/v0/paths/validation`),
    run: () => requestJson(`${config.runtimeUrl}/v0/runtime/runs/current`),
    mediaFiles: () => requestJson(`${config.catalogUrl}/v0/catalog/media-files`, { timeoutMs: 300000 }),
    mediaMissing: (files) => requestJson(`${config.catalogUrl}/v0/catalog/media-files/check`, { method: "POST", body: { files }, timeoutMs: 300000 }),
    mediaUrl: (relativePath, sha256) => `${config.catalogUrl}/v0/catalog/media-files/raw?pad=${encodeURIComponent(relativePath)}${sha256 ? `&sha256=${sha256}` : ""}`,
  };

  // Every file the version needs is put here first, checked by SHA-256. Files are only
  // added, so this changes nothing the show uses yet.
  async function fetchMediaFor(version) {
    const manifest = version.media || {};
    const wanted = {};
    for (const relativePath of mediaFilesFor(version.catalog).keys()) {
      const entry = manifest[relativePath];
      if (!entry || !entry.sha256) return { ok: false, message: `versie ${version.nr} mist het bestand ${relativePath} op de website; niets veranderd` };
      wanted[relativePath] = entry.sha256;
    }
    const { missing } = await local.mediaMissing(wanted);
    for (const relativePath of missing) {
      try {
        await transferFile(
          { url: website.mediaUrl(relativePath), headers: websiteHeaders(), website: true },
          { url: local.mediaUrl(relativePath, wanted[relativePath]) },
        );
      } catch (err) {
        if (err.status === 422 || err.status === 409) {
          return { ok: false, message: `bestand ${relativePath} kwam niet ongeschonden binnen; niets veranderd` };
        }
        throw err;
      }
    }
    if (missing.length) log(`${missing.length} bestand(en) voor versie ${version.nr} opgehaald`);
    return { ok: true, fetched: missing.length };
  }

  // Before own changes go to the website, the website gets the files it does not have.
  async function sendOwnMedia() {
    const mine = await local.mediaFiles();
    const wanted = {};
    const absent = [];
    for (const [relativePath, entry] of Object.entries(mine.files || {})) {
      if (entry && entry.sha256) wanted[relativePath] = entry.sha256;
      else absent.push(relativePath);
    }
    if (absent.length) throw new Error(`de catalogus hier verwijst naar ${absent.length} bestand(en) die niet bestaan, o.a. ${absent[0]}`);
    const { missing } = await website.mediaMissing(wanted);
    for (const relativePath of missing) {
      await transferFile(
        { url: local.mediaUrl(relativePath) },
        { url: website.mediaUrl(relativePath, wanted[relativePath]), headers: websiteHeaders(), website: true },
      );
    }
    if (missing.length) log(`${missing.length} eigen bestand(en) naar de website gestuurd`);
  }

  // As a save in the catalog does: let Show Control (TouchDesigner) reload the media of
  // the environments that changed. Best effort; the show itself never waits for it.
  async function refreshShowMedia(environmentIds) {
    const base = String(config.showControlUrl || "http://127.0.0.1:3025").replace(/\/+$/, "");
    for (const environmentId of environmentIds) {
      try {
        await requestJson(`${base}/v0/show-control/media-assets/refresh`, {
          method: "POST",
          body: { environmentId, roles: [], reason: "website_sync", source: "sync-agent" },
          timeoutMs: 2000,
        });
      } catch (_err) {
        // Show Control may be off; the media are in place for the next start.
      }
    }
  }

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      return {};
    }
  }

  function saveState(state) {
    writeFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  function saveBackup(content, label) {
    fs.mkdirSync(backupsDir, { recursive: true });
    const file = path.join(backupsDir, `${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${label}.json`);
    writeFileAtomic(file, JSON.stringify(content));
    const all = fs.readdirSync(backupsDir).filter((name) => name.endsWith(".json")).sort();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) fs.rmSync(path.join(backupsDir, old), { force: true });
    return file;
  }

  // A run keeps its own frozen catalog and paths, so a new version cannot change a run
  // that is going on. We still wait until no situation is playing and the show has been
  // quiet for a while, so scripts and screens never mix two versions.
  async function quietMoment() {
    let run;
    try {
      run = await local.run();
    } catch (err) {
      return { quiet: false, reason: `de runtime niet antwoordt (${err.message})` };
    }
    if (run && run.activeSituation) return { quiet: false, reason: "er speelt een situatie" };
    const finalization = run && run.finalizationStatus && run.finalizationStatus.status;
    if (finalization === "pending" || finalization === "running") return { quiet: false, reason: "een situatie wordt afgerond" };
    if (!run || run.status !== "running") return { quiet: true };
    const last = Date.parse(run.updatedAt || "") || 0;
    const quietFor = now() - last;
    if (quietFor >= quietMs) return { quiet: true };
    const minutes = Math.ceil((quietMs - quietFor) / 60000);
    return { quiet: false, reason: `de run was net actief; over ±${minutes} min, of meteen na een reset` };
  }

  // The version is checked on this machine before anything changes: a scratch copy of
  // the local catalog gets the new content and must validate without errors, and every
  // situation the paths use must exist in it.
  async function checkLocally(version) {
    const { buildCatalogReadModel } = require("../modules/catalog/read-model/build-read-model");
    const { validateCatalogReadModel } = require("../modules/catalog/validation/validate-catalog");
    const { readCatalogStore, writeCatalogStore } = require("../modules/catalog/write-model/catalog-store");
    const { buildPathsSnapshot } = require("../modules/paths/read-model/build-snapshot");
    const { validatePathsSnapshot } = require("../modules/paths/validation/validate-paths");
    const { readPathsStore, writePathsStore } = require("../modules/paths/db/paths-store");

    const dir = path.join(scratchRoot, `v${version.nr}-${process.pid}-${now()}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const options = { dbPath: path.join(dir, "catalog.sqlite"), mediaRoot: config.mediaRoot || undefined };
      const liveDb = config.catalogDbPath || path.join(APP_ROOT, "modules", "catalog", "db", "catalog.sqlite");
      const { DatabaseSync } = require("node:sqlite");
      const source = new DatabaseSync(liveDb, { readOnly: true });
      try {
        source.exec(`VACUUM INTO '${options.dbPath.replace(/'/g, "''")}'`);
      } finally {
        source.close();
      }
      const { catalogMediaRoot } = require("../modules/catalog/write-model/catalog-store");
      await writeCatalogStore(withCatalogContent(await readCatalogStore(options), version.catalog, { mediaRoot: catalogMediaRoot(options) }), options);
      const readModel = await buildCatalogReadModel(options);
      const catalogResult = validateCatalogReadModel(readModel);
      const problems = (catalogResult.issues || []).filter((issue) => issue.severity === "error").map((issue) => `catalogus: ${issue.code} ${issue.entityId || ""}`);

      const storePath = path.join(dir, "paths-store.json");
      await writePathsStore(withPathsContent(await readPathsStore({ storePath }), version.paths), { storePath });
      const pathsResult = validatePathsSnapshot(await buildPathsSnapshot({ storePath }));
      for (const issue of pathsResult.issues || []) if (issue.severity === "error") problems.push(`paden: ${issue.code} ${issue.entityId || ""}`);

      const known = new Set((readModel.situations || []).map((item) => Number(item.legacyId || String(item.id).split(":").pop())));
      for (const pathItem of version.paths.paths || []) {
        if (pathItem.archivedAt || pathItem.isActive === false) continue;
        for (const sceneId of pathItem.sceneIds || []) {
          if (!known.has(Number(sceneId))) problems.push(`pad ${pathItem.id}: situatie ${sceneId} bestaat niet`);
        }
      }
      return problems;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async function restore(content, label) {
    await local.putCatalog(content.catalog, null, true);
    await local.putPaths(content.paths, null, true);
    const after = await local.content();
    if (!sameHashes(after.hashes, content.hashes)) throw new Error(`terugzetten (${label}) gaf niet de verwachte inhoud`);
  }

  // An earlier apply that was cut off (power, crash) is finished or undone first.
  async function recover(state, current) {
    const applying = state.applying;
    if (!applying) return current;
    if (sameHashes(current.hashes, applying.hashes)) {
      log(`afgebroken zetten van versie ${applying.nr} was toch gelukt`);
      saveState({ ...state, applying: null, appliedVersion: applying.nr, appliedHashes: applying.hashes, appliedAt: new Date(now()).toISOString() });
    } else {
      log(`afgebroken zetten van versie ${applying.nr}: terug naar de backup`);
      const backup = JSON.parse(fs.readFileSync(applying.backupFile, "utf8"));
      await restore(backup, "na onderbreking");
      saveState({ ...state, applying: null });
    }
    return local.content();
  }

  async function apply(state, current, released) {
    const download = await website.version(released.nr);
    const version = download.version;
    const hashes = { catalog: catalogContentHash(version.catalog), paths: pathsContentHash(version.paths) };
    if (!sameHashes(hashes, released.hashes) || !sameHashes(hashes, version.hashes)) {
      return { state: "fout", message: `versie ${released.nr} kwam niet ongeschonden binnen; niets veranderd` };
    }
    if (!version.validation || !version.validation.ok) {
      return { state: "fout", message: `versie ${released.nr} heeft fouten volgens de website; niets veranderd` };
    }
    const media = await fetchMediaFor(version);
    if (!media.ok) return { state: "fout", message: media.message };
    const problems = await checkLocally(version);
    if (problems.length) {
      return { state: "fout", message: `versie ${released.nr} past niet op deze show-Mac; niets veranderd: ${problems.slice(0, 5).join("; ")}` };
    }

    const quiet = await quietMoment();
    if (!quiet.quiet) return { state: "wacht", message: `Versie ${released.nr} staat klaar; wacht omdat ${quiet.reason}.` };

    const backupFile = saveBackup({ catalog: current.catalog, paths: current.paths, hashes: current.hashes }, `voor-v${released.nr}`);
    saveState({ ...state, applying: { nr: released.nr, hashes, backupFile, backupHashes: current.hashes, at: new Date(now()).toISOString() } });

    try {
      await local.putCatalog(version.catalog, current.hashes.catalog);
    } catch (err) {
      saveState({ ...state, applying: null });
      if (err.status === 409) return { state: "wacht", message: "de catalogus veranderde net; volgende ronde opnieuw" };
      throw err;
    }
    try {
      await local.putPaths(version.paths, current.hashes.paths);
      const after = await local.content();
      if (!sameHashes(after.hashes, hashes)) throw new Error("na het zetten klopt de inhoud niet");
      const [catalogValidation, pathsValidation] = await Promise.all([local.validation(), local.pathsValidation()]);
      if (!catalogValidation.ok || !pathsValidation.ok) throw new Error("na het zetten geeft de controle fouten");
    } catch (err) {
      log(`versie ${released.nr} zetten mislukt (${err.message}); backup terug`);
      await restore({ catalog: current.catalog, paths: current.paths, hashes: current.hashes }, "na mislukte controle");
      saveState({ ...state, applying: null });
      return { state: "fout", message: `versie ${released.nr} teruggedraaid: ${err.message}` };
    }
    saveState({ ...state, applying: null, appliedVersion: released.nr, appliedHashes: hashes, appliedAt: new Date(now()).toISOString(), pendingUpload: null });
    log(`versie ${released.nr} staat in de show`);
    await refreshShowMedia(changedMediaEnvironments(current.catalog, version.catalog));
    return { state: "bijgewerkt", message: `Versie ${released.nr} staat sinds ${new Date(now()).toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam" })} in de show.` };
  }

  async function step() {
    let state = readState();
    let current = await local.content();
    current = await recover(state, current);
    state = readState();

    const stand = await website.stand();
    const released = stand.released;
    if (!released) return { state: "wacht", message: "Op de website is nog niets vrijgegeven." };

    if (!state.appliedHashes) {
      // First contact: find which website version this machine already has.
      const found = await website.find(current.hashes);
      if (found && found.nr) {
        state = { ...state, appliedVersion: found.nr, appliedHashes: current.hashes, appliedAt: new Date(now()).toISOString() };
        saveState(state);
        log(`begint op versie ${found.nr}`);
      }
    }

    const localChanged = !state.appliedHashes || !sameHashes(current.hashes, state.appliedHashes);
    if (localChanged) {
      const overwriteAllowed = state.pendingUpload && stand.overwriteLocal && stand.overwriteLocal.id === state.pendingUpload.id;
      if (!overwriteAllowed) {
        if (state.pendingUpload && sameHashes(current.hashes, state.pendingUpload.hashes)) {
          return { state: "conflict", message: "Eigen wijzigingen van de show-Mac wachten op een keuze op de website." };
        }
        await sendOwnMedia();
        const result = await website.upload({
          basis: state.appliedVersion || 0,
          catalog: current.catalog,
          paths: current.paths,
          hashes: current.hashes,
          reason: "Gewijzigd op de show-Mac",
        });
        if (result.status === "conflict") {
          saveBackup({ catalog: current.catalog, paths: current.paths, hashes: current.hashes }, "eigen-wijzigingen");
          saveState({ ...state, pendingUpload: { id: result.id, hashes: current.hashes, at: new Date(now()).toISOString() } });
          log(`eigen wijzigingen als voorstel ${result.id} naar de website; niets overschreven`);
          return { state: "conflict", message: "Eigen wijzigingen van de show-Mac wachten op een keuze op de website." };
        }
        saveState({ ...state, appliedVersion: result.nr, appliedHashes: current.hashes, appliedAt: new Date(now()).toISOString(), pendingUpload: null });
        log(`eigen wijzigingen opgenomen als versie ${result.nr}`);
        return { state: "bijgewerkt", message: `Eigen wijzigingen staan op de website als versie ${result.nr}.` };
      }
      log(`website koos voor de website-versie; eigen wijzigingen staan in de backup en als voorstel ${state.pendingUpload.id}`);
    }

    if (sameHashes(current.hashes, released.hashes)) {
      if (state.appliedVersion !== released.nr || state.pendingUpload) {
        saveState({ ...state, appliedVersion: released.nr, appliedHashes: released.hashes, pendingUpload: null });
      }
      return { state: "bijgewerkt", message: "" };
    }
    return apply(readState(), current, released);
  }

  // The prompts of the Script Agent. The team tests them on the website, apart from the show; only
  // what was put through there ("Voer door naar de show") is set here, once per number, after a
  // backup. The website hears what the show has now. Never stops the round for the content.
  async function schrijverStep() {
    let settings;
    try {
      settings = (await requestJson(`${scriptAgentUrl}/v0/script-agent/operator/settings`, { timeoutMs: 5000 })).settings;
    } catch (_err) {
      return null;
    }
    let state = readState();
    try {
      const stand = await website.stand();
      const nr = stand.schrijver && Number(stand.schrijver.nr);
      if (nr && nr !== state.schrijverNr) {
        const released = await website.schrijver();
        if (released.nr === nr && released.systemPrompt && released.promptTemplate) {
          saveBackup({ systemPrompt: settings.systemPrompt, promptTemplate: settings.promptTemplate }, `prompt-voor-${nr}`);
          settings = (await requestJson(`${scriptAgentUrl}/v0/script-agent/operator/settings`, {
            method: "PATCH",
            body: { systemPrompt: released.systemPrompt, promptTemplate: released.promptTemplate },
          })).settings;
          state = { ...readState(), schrijverNr: nr };
          saveState(state);
          log(`prompt ${nr} van de website (${released.by || "onbekend"}) staat in de Script Agent`);
        }
      }
    } catch (err) {
      if (!err.fromWebsite) log(`prompt van de website niet gezet: ${err.message}`);
    }
    return {
      systemPrompt: settings.systemPrompt,
      promptTemplate: settings.promptTemplate,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      reasoningEffort: settings.reasoningEffort,
      fallbackModel: settings.fallbackModel,
      appliedNr: state.schrijverNr || null,
    };
  }

  async function tick() {
    let status;
    try {
      status = await step();
    } catch (err) {
      const detail = err.cause && (err.cause.code || err.cause.message) ? ` (${err.cause.code || err.cause.message})` : "";
      status = err.fromWebsite && !(err instanceof HttpError)
        ? { state: "offline", message: `Website niet bereikbaar${detail}; de show houdt de huidige versie.` }
        : { state: "fout", message: `${err.fromWebsite ? "Website: " : ""}${err.message}${detail}` };
      log(`${status.state}: ${status.message}`);
    }
    const state = readState();
    const report = {
      ...status,
      appliedVersion: state.appliedVersion || null,
      pendingUpload: state.pendingUpload ? state.pendingUpload.id : null,
      at: new Date(now()).toISOString(),
    };
    writeFileAtomic(statusPath, `${JSON.stringify(report, null, 2)}\n`);
    const schrijver = await schrijverStep();
    try {
      await website.report(schrijver ? { ...report, schrijver } : report);
    } catch (_err) {
      // The website is out of reach; the status file on this machine still says it.
    }
    return report;
  }

  return { tick, readState, dataDir };
}

module.exports = {
  changedMediaEnvironments,
  createAgent,
  sameHashes,
};
