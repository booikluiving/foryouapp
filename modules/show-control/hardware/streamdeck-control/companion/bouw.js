"use strict";

// Bouwt de hele Companion-indeling uit deck.json in een Companion-configmap.
// Companion moet op die map gestopt zijn. Twee keer draaien geeft hetzelfde resultaat.
//
//   node bouw.js --config-dir <map met v4.3/> [--surface usb|emulator] [--scripts-dir <map>] [--check]

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { DIR, MAAT_MAX, MAAT_MIN, allButtons, fontSize, loadDeck, varMaat, varStaat, varTekst } = require("./lib");
const { CUES } = require("./deck-actie");

const COMPANION_NODE = "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node";

function args() {
  const out = { surface: "usb", scriptsDir: DIR, check: false, plaatjes: path.join(DIR, "plaatjes.json") };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--config-dir") out.configDir = argv[++i];
    else if (a === "--surface") out.surface = argv[++i];
    else if (a === "--scripts-dir") out.scriptsDir = argv[++i];
    else if (a === "--check") out.check = true;
    else if (a === "--plaatjes") out.plaatjes = argv[++i];
    else throw new Error(`onbekend argument: ${a}`);
  }
  if (!out.check && !out.configDir) throw new Error("--config-dir ontbreekt");
  if (!["usb", "emulator"].includes(out.surface)) throw new Error("--surface moet usb of emulator zijn");
  return out;
}

function validate(deck) {
  const errors = [];
  const pageIds = new Set(deck.paginas.map((p) => p.id));
  const keys = new Set();
  for (const page of deck.paginas) {
    const spots = new Set();
    for (const knop of page.knoppen) {
      const where = `${page.id}/${knop.key}`;
      if (!/^[a-z0-9_]+$/.test(knop.key || "")) errors.push(`${where}: key alleen a-z, 0-9, _`);
      if (keys.has(knop.key)) errors.push(`${where}: key dubbel`);
      keys.add(knop.key);
      const [r, c] = knop.plek || [];
      if (!(r >= 0 && r < deck.deck.rijen && c >= 0 && c < deck.deck.kolommen)) errors.push(`${where}: plek buiten het deck`);
      if (spots.has(`${r},${c}`)) errors.push(`${where}: plek ${r},${c} al bezet`);
      spots.add(`${r},${c}`);
      const actie = knop.actie || {};
      if (actie.pagina && !pageIds.has(actie.pagina)) errors.push(`${where}: pagina ${actie.pagina} bestaat niet`);
      if (actie.cue && !CUES[actie.cue]) errors.push(`${where}: cue ${actie.cue} onbekend`);
      if (actie.autofocus && !["alle", "cam1", "cam2", "cam3"].includes(actie.autofocus)) errors.push(`${where}: autofocus ${actie.autofocus} onbekend (alle, cam1, cam2 of cam3)`);
      if (actie.stem && actie.stem !== "start") errors.push(`${where}: stem ${actie.stem} onbekend (start)`);
      if (actie.extra && !["shot", "geluid"].includes(actie.extra)) errors.push(`${where}: extra ${actie.extra} onbekend (shot of geluid)`);
      if (actie.personage && actie.personage !== "nummer") errors.push(`${where}: personage ${actie.personage} onbekend (nummer)`);
      if (!["actie", "schakelaar", "link", "lampje", "nav", "gevaar"].includes(knop.rol)) errors.push(`${where}: rol ${knop.rol} onbekend`);
      if (!deck.onderdelen[knop.onderdeel]) errors.push(`${where}: onderdeel ${knop.onderdeel} onbekend`);
      if (!fs.existsSync(path.join(DIR, "iconen", `${knop.pictogram}.svg`))) errors.push(`${where}: pictogram ${knop.pictogram} ontbreekt in iconen/`);
    }
  }
  if (errors.length) throw new Error(`deck.json klopt niet:\n  ${errors.join("\n  ")}`);
}

const opt = (value) => ({ isExpression: false, value });

// staat (zoals deck-status.js die zet) → toon van het plaatje
const TOON = {
  uit: "off", klaar: "idle", camera: "idle", blauw: "idle", magenta: "idle", knop: "idle",
  actief: "live", aan: "on", bezig: "busy", gelukt: "done", warn: "warn",
  fout: "alert", mute: "alert", mislukt: "alert",
};

function toonVan(knop, staat) {
  if (staat === "ok") return knop.rol === "lampje" ? "on" : "idle";
  return TOON[staat] || "idle";
}

const ALLE_STATEN = ["uit", "klaar", "camera", "blauw", "magenta", "knop", "actief", "aan", "bezig", "gelukt", "warn", "fout", "mute", "mislukt", "ok"];

function tekstKleur(knop, toon) {
  if (toon === "off") return 0x8d96a0;
  if (knop.rol === "lampje") return 0xe8edf2;
  if (["warn", "busy", "done"].includes(toon)) return 0x1d1200;
  if (knop.onderdeel === "licht" && toon !== "alert") return 0x231c00;
  return 0xffffff;
}

const vrijeTekst = (knop) => !!(knop.actie && (knop.actie.extra || knop.actie.personage || Number.isInteger(knop.actie.omgeving)));

function buttonControl(deck, knop, pageNumbers, scriptsDir, plaatjes) {
  const nav = !!(knop.actie && knop.actie.pagina) && !knop.status;
  const img = (plaatjes && plaatjes[knop.key]) || {};
  const baseToon = nav ? "idle" : "off";
  const feedbacks = [];
  if (!nav) {
    const perToon = {};
    for (const staat of ALLE_STATEN) {
      const toon = toonVan(knop, staat);
      if (toon === baseToon || !img[toon]) continue;
      (perToon[toon] = perToon[toon] || []).push(staat);
    }
    const tonen = Object.entries(perToon);
    for (const [toon, staten] of tonen) {
      feedbacks.push({
        id: `fb_${knop.key}_${toon}`,
        type: "feedback",
        definitionId: "check_expression",
        connectionId: "internal",
        options: { expression: opt(staten.map((st) => `$(custom:${varStaat(knop.key)}) == '${st}'`).join(" || ")) },
        isInverted: opt(false),
        style: { png64: img[toon], color: tekstKleur(knop, toon) },
        children: {},
      });
    }
    // knoppen met vrije tekst: deck-status zet fy_<key>_m, daarmee de lettergrootte
    if (vrijeTekst(knop)) {
      for (let n = MAAT_MIN; n <= MAAT_MAX; n += 1) {
        feedbacks.push({
          id: `fb_${knop.key}_m${n}`,
          type: "feedback",
          definitionId: "check_expression",
          connectionId: "internal",
          options: { expression: opt(`$(custom:${varMaat(knop.key)}) == '${n}'`) },
          isInverted: opt(false),
          style: { size: String(fontSize(n)) },
          children: {},
        });
      }
    }
  }

  const down = [];
  if (knop.actie && knop.actie.pagina) {
    down.push({
      id: `act_${knop.key}`,
      type: "action",
      definitionId: "set_page",
      connectionId: "internal",
      options: { surfaceId: opt("self"), page: opt(String(pageNumbers[knop.actie.pagina])) },
      children: {},
    });
  } else if (knop.actie) {
    down.push({
      id: `act_${knop.key}`,
      type: "action",
      definitionId: "exec",
      connectionId: "internal",
      options: {
        path: opt(`"${COMPANION_NODE}" "${path.join(scriptsDir, "deck-actie.js")}" ${knop.key}`),
        cwd: opt(""),
        timeout: opt(5000),
        targetVariable: opt(""),
      },
      children: {},
    });
  }

  // omgevingsknoppen melden ook het loslaten: een knop die "houden" is (haperen) gaat dan weer uit
  const up = [];
  if (knop.actie && Number.isInteger(knop.actie.omgeving)) {
    up.push({
      id: `act_${knop.key}_los`,
      type: "action",
      definitionId: "exec",
      connectionId: "internal",
      options: {
        path: opt(`"${COMPANION_NODE}" "${path.join(scriptsDir, "deck-actie.js")}" ${knop.key} los`),
        cwd: opt(""),
        timeout: opt(5000),
        targetVariable: opt(""),
      },
      children: {},
    });
  }

  // vaste maat ("auto" breekt woorden af): zo groot als de langste tekst die deze knop kan tonen toelaat
  const lines = String(knop.label).split("\n");
  let tekens = Math.max(...lines.map((l) => l.length));
  if (!nav) {
    let min = 4; // flitsteksten: OK, FAIL, ...
    if (knop.rol === "schakelaar") min = knop.onderdeel === "geluid" ? 6 : 5; // UNMUTE / START, RESET
    if (knop.status || (knop.actie && knop.actie.td)) min = 7; // 10 FOUT / AL OPEN
    if (knop.rol === "lampje") min = Math.max(min, 4); // DOWN
    if (vrijeTekst(knop)) min = MAAT_MIN;
    tekens = Math.max(tekens, min);
  }
  const size = String(fontSize(tekens));
  return {
    type: "button",
    style: {
      text: nav ? knop.label : `$(custom:${varTekst(knop.key)})`,
      textExpression: false,
      size,
      png64: img[baseToon] || null,
      alignment: "center:center",
      pngalignment: "center:center",
      color: tekstKleur(knop, baseToon),
      bgcolor: 0,
      show_topbar: false,
    },
    options: { stepProgression: "auto", stepExpression: "", rotaryActions: false },
    feedbacks,
    steps: { 0: { action_sets: { down, up }, options: { runWhileHeld: [] } } },
    localVariables: [],
  };
}

function surfaceRows(deck, mode, pageIds) {
  const groupConfig = {
    name: "For_You deck",
    last_page_id: pageIds[0],
    startup_page_id: pageIds[0],
    use_last_page: false,
    restrict_pages: true,
    allowed_page_ids: pageIds,
    page: 1,
  };
  const config = { brightness: deck.deck.helderheid, rotation: 0, never_lock: true, xOffset: 0, yOffset: 0, groupId: null };
  const gridSize = { columns: deck.deck.kolommen, rows: deck.deck.rijen };
  if (mode === "usb") {
    return [[`streamdeck:${deck.deck.serial}`, {
      groupConfig, enabled: true, config, type: "Elgato Stream Deck XL", integrationType: "elgato-stream-deck", gridSize,
    }]];
  }
  return [["emulator:streamdeck-xl", {
    groupConfig,
    enabled: true,
    config: { ...config, emulator_rows: deck.deck.rijen, emulator_columns: deck.deck.kolommen, emulator_control_enable: false, emulator_prompt_fullscreen: false },
    type: "Emulator",
    integrationType: "emulator",
    gridSize,
  }]];
}

const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const j = (value) => q(JSON.stringify(value));

function buildSql(deck, opts) {
  const pageNumbers = {};
  const pageIds = [];
  deck.paginas.forEach((page, index) => {
    pageNumbers[page.id] = index + 1;
    pageIds.push(`fy_${page.id}`);
  });

  const sql = [".bail on", "BEGIN;"];
  sql.push("DELETE FROM pages;", "DELETE FROM controls;", "DELETE FROM custom_variables;", "DELETE FROM surfaces;");
  // verbindingen (oude osc) eruit; alleen het ingebouwde surface-module blijft
  sql.push("DELETE FROM instances WHERE json_extract(value,'$.moduleInstanceType')='connection';");
  sql.push(`UPDATE instances SET value=json_set(value,'$.enabled',${opts.surface === "usb" ? "json('true')" : "json('false')"}) WHERE json_extract(value,'$.moduleId')='elgato-stream-deck';`);

  let sortOrder = 0;
  deck.paginas.forEach((page, index) => {
    const controls = {};
    for (const knop of page.knoppen) {
      const [r, c] = knop.plek;
      const controlId = `bank:fy_${knop.key}`;
      (controls[r] = controls[r] || {})[c] = controlId;
      sql.push(`INSERT INTO controls (id, value) VALUES (${q(controlId)}, ${j(buttonControl(deck, knop, pageNumbers, opts.scriptsDir, opts.plaatjesData))});`);
      if (knop.actie && knop.actie.pagina && !knop.status) continue;
      sql.push(`INSERT INTO custom_variables (id, value) VALUES (${q(varTekst(knop.key))}, ${j({ description: `For_You ${knop.key} tekst`, defaultValue: knop.label, persistCurrentValue: false, sortOrder: sortOrder++ })});`);
      sql.push(`INSERT INTO custom_variables (id, value) VALUES (${q(varStaat(knop.key))}, ${j({ description: `For_You ${knop.key} staat`, defaultValue: "uit", persistCurrentValue: false, sortOrder: sortOrder++ })});`);
      if (vrijeTekst(knop)) sql.push(`INSERT INTO custom_variables (id, value) VALUES (${q(varMaat(knop.key))}, ${j({ description: `For_You ${knop.key} lettergrootte`, defaultValue: String(MAAT_MIN), persistCurrentValue: false, sortOrder: sortOrder++ })});`);
    }
    sql.push(`INSERT INTO pages (id, value) VALUES (${q(String(index + 1))}, ${j({ id: pageIds[index], name: page.naam, controls })});`);
  });

  for (const [id, value] of surfaceRows(deck, opts.surface, pageIds)) {
    sql.push(`INSERT INTO surfaces (id, value) VALUES (${q(id)}, ${j(value)});`);
  }

  const usb = opts.surface === "usb";
  sql.push(`UPDATE main SET value=json_set(value,'$.elgato_plugin_enable',json('false'),'$.usb_hotplug',json('${usb}'),'$.auto_enable_discovered_surfaces',json('${usb}'),'$.remove_topbar',json('true')) WHERE id='userconfig';`);
  sql.push(`INSERT OR REPLACE INTO main (id, value) VALUES ('fy_deck', ${j({ versie: deck.versie, surface: opts.surface, scriptsDir: opts.scriptsDir, gebouwd: new Date().toISOString() })});`);
  sql.push("COMMIT;");
  return sql.join("\n");
}

function main() {
  const opts = args();
  const deck = loadDeck();
  validate(deck);
  if (opts.check) {
    console.log(`deck.json ok: ${deck.paginas.length} pagina's, ${allButtons(deck).length} knoppen`);
    return;
  }
  if (!fs.existsSync(opts.plaatjes)) throw new Error(`geen plaatjes: ${opts.plaatjes} (eerst node render.js)`);
  opts.plaatjesData = JSON.parse(fs.readFileSync(opts.plaatjes, "utf8"));
  const db = path.join(opts.configDir, "v4.3", "db.sqlite");
  if (!fs.existsSync(db)) throw new Error(`geen database: ${db}`);
  let open = "";
  try { open = execFileSync("lsof", ["-t", db], { encoding: "utf8" }).trim(); } catch (_err) {}
  if (open) throw new Error(`Companion heeft ${db} nog open (pid ${open.split("\n").join(", ")}); eerst stoppen`);

  execFileSync("sqlite3", [db], { input: buildSql(deck, opts), stdio: ["pipe", "inherit", "inherit"] });
  console.log(`gebouwd: ${deck.paginas.map((p) => p.naam).join(", ")} (${allButtons(deck).length} knoppen, surface ${opts.surface}) in ${db}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { buildSql, validate };
