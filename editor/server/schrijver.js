"use strict";

// Script Agent testen: the operator chat and its prompts, apart from the show. The same
// operator service as on the show Mac writes the scenes here, with its own data and no
// runtime, teleprompter or show control behind it. The test prompt only reaches the show
// when someone presses "Voer door naar de show"; the show Mac's sync agent picks it up.

const fs = require("node:fs");
const path = require("node:path");

class SchrijverFout extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

const MODEL_FIELDS = ["model", "temperature", "maxTokens", "reasoningEffort", "fallbackModel"];
const MAX_PROMPT = 12000;

function clean(value) {
  return String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim().slice(0, MAX_PROMPT);
}

function writeFileAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, filePath);
}

function createSchrijver({ dir, catalogUrl, env = process.env, fetchImpl } = {}) {
  // The operator service keeps its settings and scripts in this folder (it must lie inside the app).
  process.env.SCRIPT_AGENT_DB_DIR = dir;
  fs.mkdirSync(dir, { recursive: true });
  const { catalogIndexFromCatalog, createOperatorService } = require("../../modules/script-agent/operator/operator-service");
  const { buildPromptInput } = require("../../modules/script-agent/prompt-builder/prompt-builder");

  const statePath = path.join(dir, "stand.json");
  const lastPromptInput = new Map();
  const busy = new Set();

  async function catalog() {
    const response = await fetch(`${catalogUrl}/v0/catalog/read-model`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new SchrijverFout(502, "catalogus", "De catalogus antwoordt niet.");
    return response.json();
  }

  const service = createOperatorService({
    env,
    fetchImpl,
    log: (line) => process.stdout.write(`schrijver: ${line}\n`),
    clients: {
      fetchCatalogSnapshot: async () => ({ ok: true, catalog: await catalog() }),
      fetchCurrentRuntimeState: async () => ({ ok: false, error: "geen_runtime_in_de_test" }),
    },
  });

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8")) || {};
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      return {};
    }
  }

  function saveState(patch) {
    const next = { ...readState(), ...patch };
    writeFileAtomic(statePath, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  const sessionId = (email) => `test_${String(email || "team").toLowerCase()}`;
  const samePrompts = (a, b) => Boolean(a && b && a.systemPrompt === b.systemPrompt && a.promptTemplate === b.promptTemplate);

  async function stand(email) {
    const settings = await service.readSettings();
    const state = readState();
    const show = state.show || null;
    const released = state.vrijgegeven || null;
    const secrets = await service.secretsStatus();
    return {
      me: email,
      proef: { systemPrompt: settings.systemPrompt, promptTemplate: settings.promptTemplate, by: state.proefBy || null, at: state.proefAt || null },
      show: show ? { systemPrompt: show.systemPrompt, promptTemplate: show.promptTemplate, at: show.at || null } : null,
      gelijkAanShow: samePrompts(settings, show),
      vrijgegeven: released ? {
        nr: released.nr,
        by: released.by,
        at: released.at,
        inDeShow: Boolean(show && show.appliedNr === released.nr),
        gelijkAanProef: samePrompts(settings, released),
      } : null,
      model: Object.fromEntries(MODEL_FIELDS.map((key) => [key, settings[key]])),
      sleutel: Boolean(secrets.deepseek.configured || secrets.claude.configured),
      bezig: busy.has(sessionId(email)),
      gesprek: service.sessionInfo(sessionId(email)).messages,
    };
  }

  async function saveProef(email, body = {}) {
    const systemPrompt = clean(body.systemPrompt);
    const promptTemplate = clean(body.promptTemplate);
    if (!systemPrompt || !promptTemplate) throw new SchrijverFout(400, "leeg", "De hoofdprompt en de opdracht per scène mogen niet leeg zijn.");
    const current = await service.readSettings();
    if (!samePrompts(current, { systemPrompt, promptTemplate })) {
      await service.saveSettings({ systemPrompt, promptTemplate });
      saveState({ proefBy: email, proefAt: new Date().toISOString() });
    }
    return stand(email);
  }

  async function vanShow(email) {
    const show = readState().show;
    if (!show) throw new SchrijverFout(409, "geen_show", "De show-Mac heeft zijn prompt nog niet gemeld.");
    return saveProef(email, show);
  }

  async function doorvoeren(email) {
    const settings = await service.readSettings();
    if (!settings.promptTemplate.includes("{runtimePrompt}")) {
      throw new SchrijverFout(400, "sjabloon", "In de opdracht per scène ontbreekt {runtimePrompt}. Zonder dat krijgt de schrijver geen situatie, personages en omgeving.");
    }
    const state = readState();
    const nr = ((state.vrijgegeven && state.vrijgegeven.nr) || 0) + 1;
    saveState({ vrijgegeven: { nr, systemPrompt: settings.systemPrompt, promptTemplate: settings.promptTemplate, by: email, at: new Date().toISOString() } });
    return stand(email);
  }

  async function catalogus() {
    const index = catalogIndexFromCatalog(await catalog());
    return { situaties: index.situaties, personages: index.personages, omgevingen: index.omgevingen };
  }

  // The prompt as the show builds it for a scene that is set ready: situation, environment and
  // the characters with their descriptions, put into the template.
  async function klaarzetten(email, body = {}) {
    const full = await catalog();
    const active = (items) => (items || []).filter((item) => item && item.id && item.active !== false && !item.archivedAt);
    const title = (item) => String(item.title || item.name || item.id || "").trim();
    const situation = active(full.situations).find((item) => item.id === String(body.situationId || ""));
    if (!situation) throw new SchrijverFout(400, "situatie", "Kies een situatie.");
    const characters = new Map(active(full.characters).map((item) => [item.id, item]));
    const asked = Array.isArray(body.characterIds) && body.characterIds.length ? body.characterIds : situation.characterIds || [];
    const chosen = [...new Set(asked.map(String))].filter((id) => characters.has(id)).map((id) => characters.get(id));
    if (!chosen.length) throw new SchrijverFout(400, "personages", "Kies minstens één personage.");
    const environmentId = String(body.environmentId || situation.environmentId || "");
    const environment = environmentId ? active(full.environments).find((item) => item.id === environmentId) : null;
    const promptInput = buildPromptInput({
      showRunId: sessionId(email),
      status: "test",
      showRunSnapshot: { catalog: full },
      resolvedPreparedNext: {
        situationId: situation.id,
        legacySituationId: situation.legacyId || null,
        title: title(situation),
        promptText: situation.promptText || situation.description || "",
        labelIds: situation.labelIds || [],
        environment: environment ? { id: environment.id, legacyId: environment.legacyId || null, name: title(environment) } : null,
        characters: chosen.map((item) => ({
          id: item.id,
          legacyId: item.legacyId || null,
          name: title(item),
          promptText: item.promptText || "",
          description: item.description || "",
          performerIds: item.performerIds || [],
        })),
      },
    });
    lastPromptInput.set(sessionId(email), promptInput);
    return { tekst: service.buildOperatorPrompt(promptInput, await service.readSettings()) };
  }

  async function chat(email, body = {}, emit = () => {}) {
    const id = sessionId(email);
    const message = clean(body.message);
    if (!message) throw new SchrijverFout(400, "leeg", "Er is niets om te versturen.");
    const promptInput = lastPromptInput.get(id);
    if (!promptInput) throw new SchrijverFout(409, "geen_scene", "Zet eerst een scène klaar.");
    if (busy.has(id)) throw new SchrijverFout(409, "bezig", "De schrijver is nog bezig.");
    busy.add(id);
    try {
      return await service.streamChat({ sessionId: id, message, promptInput, sourceId: "test" }, emit);
    } finally {
      busy.delete(id);
    }
  }

  function wis(email) {
    service.clearSession(sessionId(email));
    return { gesprek: [] };
  }

  // ---- Show Mac ----
  function vrijgegeven() {
    return readState().vrijgegeven || null;
  }

  // What the show Mac has now. The model and its settings always follow the show; the prompts
  // only the first time, so the test starts from what the show uses.
  async function meldingVanShow(report) {
    if (!report || typeof report !== "object" || !report.systemPrompt || !report.promptTemplate) return;
    const show = {
      systemPrompt: clean(report.systemPrompt),
      promptTemplate: clean(report.promptTemplate),
      appliedNr: Number(report.appliedNr) || null,
      ...Object.fromEntries(MODEL_FIELDS.filter((key) => report[key] != null).map((key) => [key, report[key]])),
    };
    const state = readState();
    const { at: _at, ...before } = state.show || {};
    if (JSON.stringify(before) !== JSON.stringify(show)) saveState({ show: { ...show, at: new Date().toISOString() } });
    const settings = await service.readSettings();
    const patch = {};
    for (const key of MODEL_FIELDS) if (show[key] != null && show[key] !== settings[key]) patch[key] = show[key];
    if (!state.proefAt && !samePrompts(settings, show)) {
      patch.systemPrompt = show.systemPrompt;
      patch.promptTemplate = show.promptTemplate;
    }
    if (Object.keys(patch).length) {
      await service.saveSettings(patch);
      if (patch.systemPrompt) saveState({ proefBy: "show-Mac", proefAt: new Date().toISOString() });
    }
  }

  return { catalogus, chat, doorvoeren, klaarzetten, meldingVanShow, saveProef, stand, vanShow, vrijgegeven, wis };
}

module.exports = { SchrijverFout, createSchrijver };
