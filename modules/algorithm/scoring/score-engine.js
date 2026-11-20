"use strict";

const {
  ALGORITHM_CONFIG_SCHEMA_VERSION,
  ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
} = require("../../../shared/contracts/algorithm-v0");
const { beoordeelMetWoorden } = require("./chat-toon");

function defaultAlgorithmConfig() {
  return {
    schemaVersion: ALGORITHM_CONFIG_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      type: "algorithm-v0-default-config",
      readOnly: true,
    },
    // De score van een scène is de som van drie delen, elk van -1 tot 1, keer het gewicht:
    // het oordeel na de scène (het zwaarst), de chat en de likes tijdens de scène.
    weights: {
      // Oordeel na de scène (thermometer): Nooit meer -1, Matig -1/3, Goed +1/3, Nog een keer +1, gemiddeld.
      oordeel: 3,
      // Chat: per bericht positief +1, neutraal 0, negatief -1 (taalmodel); per telefoon hooguit 3,
      // gedeeld door het aantal telefoons.
      chat: 1,
      // Likes tijdens de scène: per telefoon tellen hooguit 10 likes (en 10 saai), gedeeld door 10 × telefoons.
      likes: 0.5,
      // Een personage dat in de chat genoemd wordt (voor of tegen) telt als dit deel van een stem
      // bij de personagevraag.
      chatNaam: 0.5,
      labelAffinity: 0.25,
      characterAffinity: 0.15,
      diversity: 0,
      exploration: 0,
      retry: 0,
      sceneRepeatPenalty: 0,
      // Zaalgeluid: punten per dB dat de piek boven het gewone niveau van de scène uitkomt. 0 = telt niet mee.
      roomSound: 0,
      // Publiekscamera: punten per lachmoment (een flink deel van de zaal lacht) en per saai moment
      // (de helft kijkt minstens 5 seconden weg, omlaag of met de ogen dicht). 0 = telt niet mee.
      cameraLaugh: 0,
      cameraBored: 0,
      // Publieksvraag na de scène over het label (te veel / precies goed / mag meer): de voorkeur, van -1
      // tot 1, telt met dit gewicht op bij elke scène met dat label.
      labelVoorkeur: 1,
      // Publieksvraag na de scène welk personage je nog een keer wilt zien: het aandeel van de stemmen
      // (0 tot 1) telt met dit gewicht op bij elke scène met dat personage.
      personageVoorkeur: 1,
      // Padvoorkeur: vond het publiek een scène goed (of slecht), dan krijgen de scènes die in een pad
      // direct na die scène komen haar score × dit gewicht mee. Zo loopt een run vaker verder in een pad
      // dat het publiek leuk vindt. Half gewicht: de volgende scène krijgt de helft van de score van de vorige.
      padVolgende: 0.5,
      // Zaaloordeel: het oordeel van de operator of de spelers (knop op het deck, applausmeter op de
      // telefoon), van -1 tot 1. Weegt minder dan het publiek (oordeel 3), maar telt ook als er niemand stemt.
      zaal: 1,
    },
    // Grenzen tegen spammen: zoveel telt er per telefoon per scène.
    grenzen: {
      likesPerTelefoon: 10,
      chatPerTelefoon: 3,
    },
    normalization: {
      timeCorrection: 1,
      audienceSize: 1,
    },
    profile: {
      memoryMode: "cumulative_recency",
      recencyHalfLifeObservations: 6,
      liveWeightMultiplier: 1.25,
    },
    neutralPredictedScore: 0,
  };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = safeNumber(value, fallback);
  if (number < min) return min;
  if (number > max) return max;
  return number;
}

function rounded(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(safeNumber(value, 0) * factor) / factor;
}

function normalizeAlgorithmConfig(input = {}, options = {}) {
  const defaults = defaultAlgorithmConfig();
  const base = options.base && typeof options.base === "object" ? options.base : defaults;
  const source = input && typeof input === "object" ? input : {};
  const sourceWeights = source.weights && typeof source.weights === "object" ? source.weights : {};
  const baseWeights = base.weights && typeof base.weights === "object" ? base.weights : defaults.weights;
  const sourceNormalization = source.normalization && typeof source.normalization === "object" ? source.normalization : {};
  const baseNormalization = base.normalization && typeof base.normalization === "object"
    ? base.normalization
    : defaults.normalization;
  const sourceGrenzen = source.grenzen && typeof source.grenzen === "object" ? source.grenzen : {};
  const baseGrenzen = base.grenzen && typeof base.grenzen === "object" ? base.grenzen : defaults.grenzen;
  const sourceProfile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const baseProfile = base.profile && typeof base.profile === "object" ? base.profile : defaults.profile;
  const now = new Date().toISOString();
  const memoryMode = sourceProfile.memoryMode || source.memoryMode || baseProfile.memoryMode;
  return {
    schemaVersion: ALGORITHM_CONFIG_SCHEMA_VERSION,
    createdAt: source.createdAt || base.createdAt || now,
    updatedAt: source.updatedAt || base.updatedAt || now,
    source: {
      type: source.source && source.source.type ? String(source.source.type).slice(0, 80) : "algorithm-v0-config",
      readOnly: !!(source.source && source.source.readOnly),
    },
    weights: {
      oordeel: rounded(clampNumber(sourceWeights.oordeel, 0, 10, baseWeights.oordeel ?? defaults.weights.oordeel), 3),
      chat: rounded(clampNumber(sourceWeights.chat, 0, 10, baseWeights.chat ?? defaults.weights.chat), 3),
      likes: rounded(clampNumber(sourceWeights.likes, 0, 10, baseWeights.likes ?? defaults.weights.likes), 3),
      chatNaam: rounded(clampNumber(sourceWeights.chatNaam, 0, 10, baseWeights.chatNaam ?? defaults.weights.chatNaam), 3),
      labelAffinity: rounded(clampNumber(sourceWeights.labelAffinity ?? source.labelAffinity, -10, 10, baseWeights.labelAffinity), 3),
      characterAffinity: rounded(clampNumber(sourceWeights.characterAffinity ?? source.characterAffinity, -10, 10, baseWeights.characterAffinity), 3),
      diversity: rounded(clampNumber(sourceWeights.diversity ?? source.diversityWeight, 0, 50, baseWeights.diversity), 3),
      exploration: rounded(clampNumber(sourceWeights.exploration ?? source.explorationWeight, 0, 50, baseWeights.exploration), 3),
      retry: rounded(clampNumber(sourceWeights.retry ?? source.retryWeight, 0, 50, baseWeights.retry), 3),
      roomSound: rounded(clampNumber(sourceWeights.roomSound, 0, 10, baseWeights.roomSound ?? 0), 3),
      cameraLaugh: rounded(clampNumber(sourceWeights.cameraLaugh, -10, 10, baseWeights.cameraLaugh ?? 0), 3),
      cameraBored: rounded(clampNumber(sourceWeights.cameraBored, -10, 10, baseWeights.cameraBored ?? 0), 3),
      labelVoorkeur: rounded(clampNumber(sourceWeights.labelVoorkeur, -10, 10, baseWeights.labelVoorkeur ?? 1), 3),
      personageVoorkeur: rounded(clampNumber(sourceWeights.personageVoorkeur, -10, 10, baseWeights.personageVoorkeur ?? 1), 3),
      padVolgende: rounded(clampNumber(sourceWeights.padVolgende, 0, 10, baseWeights.padVolgende ?? 0.5), 3),
      zaal: rounded(clampNumber(sourceWeights.zaal, 0, 10, baseWeights.zaal ?? 1), 3),
      sceneRepeatPenalty: rounded(clampNumber(
        sourceWeights.sceneRepeatPenalty ?? source.sceneRepeatPenalty,
        0,
        50,
        baseWeights.sceneRepeatPenalty
      ), 3),
    },
    grenzen: {
      likesPerTelefoon: Math.round(clampNumber(sourceGrenzen.likesPerTelefoon, 1, 1000, baseGrenzen.likesPerTelefoon ?? defaults.grenzen.likesPerTelefoon)),
      chatPerTelefoon: Math.round(clampNumber(sourceGrenzen.chatPerTelefoon, 1, 100, baseGrenzen.chatPerTelefoon ?? defaults.grenzen.chatPerTelefoon)),
    },
    normalization: {
      timeCorrection: rounded(clampNumber(
        sourceNormalization.timeCorrection ?? source.timeCorrection ?? source.durationNormalization,
        0,
        1,
        baseNormalization.timeCorrection
      ), 3),
      audienceSize: rounded(clampNumber(
        sourceNormalization.audienceSize ?? source.audienceSizeNormalization,
        0,
        1,
        baseNormalization.audienceSize
      ), 3),
    },
    profile: {
      memoryMode: memoryMode === "cumulative_recency" ? "cumulative_recency" : defaults.profile.memoryMode,
      recencyHalfLifeObservations: rounded(clampNumber(
        sourceProfile.recencyHalfLifeObservations ?? source.recencyHalfLifeObservations,
        1,
        100,
        baseProfile.recencyHalfLifeObservations
      ), 3),
      liveWeightMultiplier: rounded(clampNumber(
        sourceProfile.liveWeightMultiplier ?? source.liveWeightMultiplier,
        0,
        10,
        baseProfile.liveWeightMultiplier
      ), 3),
    },
    neutralPredictedScore: rounded(clampNumber(source.neutralPredictedScore, -1000, 1000, base.neutralPredictedScore), 3),
  };
}

function catalogFromRunSnapshot(runSnapshotOrCatalog) {
  if (!runSnapshotOrCatalog || typeof runSnapshotOrCatalog !== "object") return null;
  if (runSnapshotOrCatalog.catalog && Array.isArray(runSnapshotOrCatalog.catalog.situations)) {
    return runSnapshotOrCatalog.catalog;
  }
  if (Array.isArray(runSnapshotOrCatalog.situations)) return runSnapshotOrCatalog;
  return null;
}

// Per scène de scènes die in een pad direct ervoor komen, uit de paden van de run (paths.snapshot.v0).
// Wordt bij het begin van een run bij de catalogus van het algoritme gezet (catalog.padVoorgangers).
function padVoorgangersUitPaden(paths) {
  const lijst = paths && Array.isArray(paths.paths) ? paths.paths : [];
  const uit = {};
  for (const pad of lijst) {
    if (!pad || pad.active === false || pad.archivedAt) continue;
    for (const edge of Array.isArray(pad.edges) ? pad.edges : []) {
      const van = edge && edge.fromSituationId ? String(edge.fromSituationId) : "";
      const naar = edge && edge.toSituationId ? String(edge.toSituationId) : "";
      if (!van || !naar || van === naar) continue;
      if (!uit[naar]) uit[naar] = [];
      if (!uit[naar].includes(van)) uit[naar].push(van);
    }
  }
  return uit;
}

function activeSituations(catalog) {
  return (catalog && Array.isArray(catalog.situations) ? catalog.situations : [])
    .filter((item) => item.active !== false && !item.archivedAt);
}

function situationById(catalog, situationId) {
  return activeSituations(catalog).find((item) => item.id === situationId) || null;
}

function durationFactor(durationSeconds, config = defaultAlgorithmConfig()) {
  const duration = Math.max(15, safeNumber(durationSeconds, 60));
  const fullCorrection = Math.sqrt(60 / duration);
  const correction = config.normalization ? safeNumber(config.normalization.timeCorrection, 1) : 1;
  return fullCorrection ** clampNumber(correction, 0, 1, 1);
}

function audienceFactor(activeClients, config = defaultAlgorithmConfig()) {
  const clients = Math.max(1, safeNumber(activeClients, 1));
  const fullCorrection = 1 / Math.sqrt(clients);
  const correction = config.normalization ? safeNumber(config.normalization.audienceSize, 1) : 1;
  return fullCorrection ** clampNumber(correction, 0, 1, 1);
}

function signalCounts(event) {
  const chatApp = event.chatAppSignals || {};
  const audience = event.audience || {};
  return {
    hearts: Math.max(0, safeNumber(chatApp.heartCount, 0)),
    bored: Math.max(0, safeNumber(chatApp.boredCount, 0)),
    messages: Array.isArray(chatApp.rawMessages) ? chatApp.rawMessages.length : 0,
    activeClients: Math.max(1, safeNumber(audience.activeClients, 1)),
    durationSeconds: Math.max(1, safeNumber(event.durationSeconds, 60)),
  };
}

// Hoeveel dB de piek van het zaalgeluid boven het gewone niveau van de scène uitkwam.
function roomSoundLift(event) {
  const sound = event && event.roomSound;
  if (!sound || typeof sound !== "object") return 0;
  return Math.max(0, safeNumber(sound.liftDb, 0));
}

// Wat de publiekscamera in de scène zag: lachmomenten en saaie momenten.
function cameraMoments(event) {
  const camera = event && event.camera;
  if (!camera || typeof camera !== "object") return { laugh: 0, bored: 0 };
  return {
    laugh: Math.max(0, safeNumber(camera.laughMoments, 0)),
    bored: Math.max(0, safeNumber(camera.boredMoments, 0)),
  };
}

function cameraPoints(event, weights = {}) {
  const moments = cameraMoments(event);
  return (moments.laugh * safeNumber(weights.cameraLaugh, 0)) + (moments.bored * safeNumber(weights.cameraBored, 0));
}

// De telefoons van echte mensen (geen bots) die in deze scène iets deden, per telefoon wat ze deden.
function mensenInScene(event = {}) {
  const per = new Map();
  const van = (sleutel) => {
    if (!per.has(sleutel)) per.set(sleutel, { hart: 0, saai: 0, chat: [] });
    return per.get(sleutel);
  };
  const refs = Array.isArray(event.signalRefs) ? event.signalRefs : null;
  const bewaard = !refs && event.perTelefoon && typeof event.perTelefoon === "object" ? event.perTelefoon : null;
  if (bewaard) {
    for (const [sleutel, rij] of Object.entries(bewaard)) {
      const mens = van(sleutel);
      mens.hart += Math.max(0, Number(rij && rij.hart) || 0);
      mens.saai += Math.max(0, Number(rij && rij.saai) || 0);
    }
  }
  if (refs) {
    for (const ref of refs) {
      if (!ref || ref.isBot || ref.simulated) continue;
      const sleutel = String(ref.clientKey || ref.clientId || ref.sessionId || "");
      if (!sleutel) continue;
      if (ref.type === "heart") van(sleutel).hart += 1;
      else if (ref.type === "bored") van(sleutel).saai += 1;
      else van(sleutel);
    }
  }
  const chat = Array.isArray(event.rawChat) ? event.rawChat : [];
  chat.forEach((bericht, i) => {
    if (!bericht || bericht.isBot || bericht.simulated || !String(bericht.text || "").trim()) return;
    const sleutel = String(bericht.clientKey || bericht.clientId || `bericht:${i}`);
    van(sleutel).chat.push({ id: String(bericht.signalId || `bericht:${i}`), tekst: String(bericht.text) });
  });
  return { per, metRefs: !!(refs || bewaard) };
}

// Het zaaloordeel (operator of spelers): -1 tot 1, of null als het niet gegeven is.
function zaalOordeelVan(event = {}) {
  const zaal = event.zaalOordeel;
  if (!zaal || typeof zaal !== "object" || !Number.isFinite(Number(zaal.waarde))) return null;
  return rounded(clampNumber(Number(zaal.waarde), -1, 1, 0), 4);
}

// Het oordeel na de scène: gemiddelde van -1 tot 1 en hoeveel telefoons stemden.
function oordeelVan(event = {}) {
  const oordeel = event.oordeel;
  if (!oordeel || typeof oordeel !== "object") return null;
  const gemiddelde = Number(oordeel.gemiddelde);
  const stemmen = Math.max(0, Number(oordeel.stemmen) || 0);
  if (!stemmen || !Number.isFinite(gemiddelde)) return null;
  return { gemiddelde: clampNumber(gemiddelde, -1, 1, 0), stemmen, mensen: Math.max(0, Number(oordeel.mensen) || 0) };
}

// De beoordeling van elk chatbericht: van het taalmodel als die er is, anders de woordenlijst.
function chatBeoordeling(event, bericht, personages) {
  const bekend = event && event.chatOordeel && event.chatOordeel[bericht.id];
  return bekend && Number.isFinite(Number(bekend.toon)) ? bekend : beoordeelMetWoorden(bericht.tekst, personages);
}

function personagesUitCatalogus(catalog) {
  return ((catalog && catalog.characters) || [])
    .filter((item) => item && item.id && String(item.name || "").trim())
    .map((item) => ({ id: String(item.id), naam: String(item.name).trim() }));
}

// De delen van de score van een scène: oordeel, chat en likes (elk van -1 tot 1), het aantal telefoons
// waardoor gedeeld wordt, en de personages die in de chat genoemd werden.
function scoreOnderdelen(event = {}, config = defaultAlgorithmConfig(), options = {}) {
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const weights = normalizedConfig.weights || {};
  const grenzen = normalizedConfig.grenzen || {};
  const likesMax = Math.max(1, safeNumber(grenzen.likesPerTelefoon, 10));
  const chatMax = Math.max(1, safeNumber(grenzen.chatPerTelefoon, 3));
  const personages = options.personages || [];
  const { per, metRefs } = mensenInScene(event);
  const oordeel = oordeelVan(event);
  const counts = signalCounts(event);
  const telefoons = Math.max(
    1,
    per.size,
    oordeel ? oordeel.stemmen : 0,
    oordeel ? oordeel.mensen : 0,
    metRefs ? 0 : counts.activeClients,
  );
  let likesSom = 0;
  if (metRefs) {
    for (const mens of per.values()) likesSom += Math.min(mens.hart, likesMax) - Math.min(mens.saai, likesMax);
  } else {
    likesSom = Math.min(counts.hearts, likesMax * telefoons) - Math.min(counts.bored, likesMax * telefoons);
  }
  const likes = clampNumber(likesSom / (likesMax * telefoons), -1, 1, 0);
  let chatSom = 0;
  let berichten = 0;
  const namen = new Map();
  const losseBerichten = !Array.isArray(event.rawChat) || !event.rawChat.length
    ? (Array.isArray((event.chatAppSignals || {}).rawMessages) ? event.chatAppSignals.rawMessages : [])
    : [];
  const telefoonChat = [...per.values()].map((mens) => mens.chat).filter((lijst) => lijst.length);
  losseBerichten.forEach((tekst, i) => telefoonChat.push([{ id: `los:${i}`, tekst: String(tekst || "") }]));
  for (const lijst of telefoonChat) {
    let toon = 0;
    const genoemd = new Map();
    for (const bericht of lijst) {
      const beoordeling = chatBeoordeling(event, bericht, personages);
      toon += Math.sign(Number(beoordeling.toon) || 0);
      for (const p of beoordeling.personages || []) genoemd.set(p.id, (genoemd.get(p.id) || 0) + Math.sign(Number(p.toon) || 0));
      berichten += 1;
    }
    chatSom += clampNumber(toon, -chatMax, chatMax, 0);
    for (const [id, waarde] of genoemd) namen.set(id, (namen.get(id) || 0) + clampNumber(waarde, -1, 1, 0));
  }
  const chat = clampNumber(chatSom / telefoons, -1, 1, 0);
  const chatNamen = [...namen.entries()]
    .filter(([, waarde]) => waarde !== 0)
    .map(([characterId, waarde]) => ({ characterId, waarde: rounded(clampNumber(waarde / telefoons, -1, 1, 0) * safeNumber(weights.chatNaam, 0.5), 4) }));
  const delen = {
    oordeel: oordeel ? rounded(oordeel.gemiddelde, 4) : null,
    oordeelStemmen: oordeel ? oordeel.stemmen : 0,
    chat: rounded(chat, 4),
    chatBerichten: berichten,
    likes: rounded(likes, 4),
    telefoons,
    zaalgeluid: rounded(roomSoundLift(event) * safeNumber(weights.roomSound, 0), 4),
    camera: rounded(cameraPoints(event, weights), 4),
    // Het zaaloordeel van de operator of de spelers (-1..1), als dat gegeven is.
    zaalOordeel: zaalOordeelVan(event),
  };
  delen.punten = {
    oordeel: rounded((oordeel ? oordeel.gemiddelde : 0) * safeNumber(weights.oordeel, 3), 4),
    chat: rounded(chat * safeNumber(weights.chat, 1), 4),
    likes: rounded(likes * safeNumber(weights.likes, 0.5), 4),
    zaal: rounded((delen.zaalOordeel || 0) * safeNumber(weights.zaal, 1), 4),
  };
  delen.totaal = rounded(delen.punten.oordeel + delen.punten.chat + delen.punten.likes + delen.punten.zaal + delen.zaalgeluid + delen.camera, 4);
  return { ...delen, chatNamen };
}

function observedScoreForEvent(event, config = defaultAlgorithmConfig(), options = {}) {
  return scoreOnderdelen(event, config, options).totaal;
}

function affinityForSituation(situation, observedSituation, config) {
  if (!situation || !observedSituation) return 0;
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const weights = normalizedConfig.weights || {};
  const labels = new Set(observedSituation.labelIds || []);
  const characters = new Set(observedSituation.characterIds || []);
  const sharedLabels = (situation.labelIds || []).filter((id) => labels.has(id)).length;
  const sharedCharacters = (situation.characterIds || []).filter((id) => characters.has(id)).length;
  return (sharedLabels * safeNumber(weights.labelAffinity, 0.25))
    + (sharedCharacters * safeNumber(weights.characterAffinity, 0.15));
}

function average(values = []) {
  const safeValues = values.map((value) => safeNumber(value, NaN)).filter(Number.isFinite);
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function observationStats(observations = []) {
  const bySituation = new Map();
  const characterCounts = new Map();
  for (const observation of observations) {
    if (!observation || !observation.situationId) continue;
    const current = bySituation.get(observation.situationId) || {
      count: 0,
      total: 0,
      latest: null,
    };
    current.count += 1;
    current.total += safeNumber(observation.observedScore, 0);
    current.latest = observation;
    bySituation.set(observation.situationId, current);
    for (const characterId of observation.characterIds || []) {
      characterCounts.set(characterId, Number(characterCounts.get(characterId) || 0) + 1);
    }
  }
  return { bySituation, characterCounts };
}

function recencyWeightForObservation(index, total, config) {
  const profile = (normalizeAlgorithmConfig(config).profile || {});
  if (profile.memoryMode !== "cumulative_recency") return 1;
  const age = Math.max(0, Number(total || 0) - 1 - Number(index || 0));
  const halfLife = Math.max(1, safeNumber(profile.recencyHalfLifeObservations, 6));
  return 0.5 ** (age / halfLife);
}

function addWeightedProfile(map, id, observedScore, weight, source = {}) {
  if (!id) return;
  const current = map.get(id) || {
    total: 0,
    weight: 0,
    count: 0,
    liveWeight: 0,
  };
  current.total += safeNumber(observedScore, 0) * weight;
  current.weight += weight;
  current.count += 1;
  if (source.live) current.liveWeight += weight;
  map.set(id, current);
}

function profileEntryValue(entry) {
  if (!entry || !entry.weight) return 0;
  return entry.total / entry.weight;
}

// Personagevoorkeur vervaagt: recente scènes wegen 1, oudere minder (halfwaarde recencyHalfLifeObservations).
// Door te delen door minstens 1 telt een oude favoriet die niet terugkomt steeds minder; komt hij terug
// en valt hij goed, dan staat hij meteen weer vooraan.
function vervaagdeWaarde(entry) {
  if (!entry || !entry.weight) return 0;
  return entry.total / Math.max(entry.weight, 1);
}

function profileAverageForIds(map, ids = []) {
  const values = (ids || [])
    .map((id) => map.get(id))
    .filter((entry) => entry && entry.weight > 0)
    .map(profileEntryValue);
  return values.length ? average(values) : 0;
}

function profileLiveWeightForIds(map, ids = []) {
  return (ids || [])
    .map((id) => map.get(id))
    .filter(Boolean)
    .reduce((sum, entry) => sum + safeNumber(entry.liveWeight, 0), 0);
}

// De personagevraag als voorkeur van -1 tot 1 per personage. Een gelijke verdeling over de personages
// van de scène is 0 (geen voorkeur); meer stemmen dan gelijk is plus, minder is min. Bij één personage
// ("Wil je X terugzien?") is het ja min "Hoeft niet" (keuze "nee").
function personageVoorkeurWaarden(personages) {
  const keuzes = personages && Array.isArray(personages.keuzes)
    ? personages.keuzes.filter((keuze) => keuze && keuze.characterId && Number.isFinite(Number(keuze.aandeel)))
    : [];
  const echte = keuzes.filter((keuze) => String(keuze.characterId) !== "nee");
  const nee = keuzes.find((keuze) => String(keuze.characterId) === "nee");
  if (!echte.length) return [];
  if (echte.length === 1) {
    const ja = Number(echte[0].aandeel);
    const niet = nee ? Number(nee.aandeel) : 1 - ja;
    return [[String(echte[0].characterId), clampNumber(ja - niet, -1, 1, 0)]];
  }
  const gelijk = 1 / echte.length;
  // Van -1 (niemand koos hem) tot 1 (iedereen koos hem), 0 bij een gelijke verdeling.
  return echte.map((keuze) => {
    const aandeel = Number(keuze.aandeel);
    const waarde = aandeel >= gelijk ? (aandeel - gelijk) / (1 - gelijk) : (aandeel - gelijk) / gelijk;
    return [String(keuze.characterId), clampNumber(waarde, -1, 1, 0)];
  });
}

function buildRunProfile(observations = [], liveObservation = null, config = defaultAlgorithmConfig()) {
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const profile = {
    situations: new Map(),
    labels: new Map(),
    characters: new Map(),
    // Wat het publiek na de scène over het label zei: per label een voorkeur van -1 tot 1.
    labelVoorkeur: new Map(),
    // Welk personage het publiek nog een keer wil zien: per personage het aandeel van de stemmen.
    personageVoorkeur: new Map(),
    includesLive: !!liveObservation,
  };
  const addObservation = (observation, weight, source = {}) => {
    if (!observation || !observation.situationId) return;
    const score = safeNumber(observation.observedScore, 0);
    addWeightedProfile(profile.situations, observation.situationId, score, weight, source);
    for (const labelId of observation.labelIds || []) {
      addWeightedProfile(profile.labels, labelId, score, weight, source);
    }
    for (const characterId of observation.characterIds || []) {
      addWeightedProfile(profile.characters, characterId, score, weight, source);
    }
    const voorkeur = observation.labelVoorkeur;
    if (voorkeur && voorkeur.labelId && Number.isFinite(Number(voorkeur.delta))) {
      addWeightedProfile(profile.labelVoorkeur, String(voorkeur.labelId), Number(voorkeur.delta), weight, source);
    }
    // Per personage: het aandeel van de stemmen bij de personagevraag, plus wat de chat over dat
    // personage zei (ook personages die niet in de scène zaten: "wij willen Bea weer").
    const perPersonage = new Map();
    const personages = observation.personageVoorkeur;
    // Een toppersonage uit een scène die iedereen goed vond telt zwaarder dan een uit een slechte scène:
    // een voorkeur boven 0 keer 1 + ¼ × het oordeel over de scène (slecht 0,75, neutraal 1, goed 1,25).
    const oordeel = observation.oordeel && Number.isFinite(Number(observation.oordeel.gemiddelde))
      ? Math.max(-1, Math.min(1, Number(observation.oordeel.gemiddelde)))
      : 0;
    for (const [characterId, waarde] of personageVoorkeurWaarden(personages)) {
      perPersonage.set(characterId, waarde > 0 ? waarde * (1 + 0.25 * oordeel) : waarde);
    }
    for (const naam of Array.isArray(observation.chatNamen) ? observation.chatNamen : []) {
      if (naam && naam.characterId && Number.isFinite(Number(naam.waarde))) {
        const id = String(naam.characterId);
        perPersonage.set(id, (perPersonage.get(id) || 0) + Number(naam.waarde));
      }
    }
    for (const [characterId, waarde] of perPersonage) {
      addWeightedProfile(profile.personageVoorkeur, characterId, waarde, weight, source);
    }
  };
  observations.forEach((observation, index) => {
    addObservation(observation, recencyWeightForObservation(index, observations.length, normalizedConfig));
  });
  if (liveObservation) {
    addObservation(liveObservation, safeNumber(normalizedConfig.profile.liveWeightMultiplier, 1.25), { live: true });
  }
  return profile;
}

function recentCharacterPenalty(situation, observations = [], weight = 0) {
  if (!weight || !situation) return 0;
  const characterIds = new Set(situation.characterIds || []);
  if (!characterIds.size) return 0;
  const recent = observations.slice(-3);
  let penalty = 0;
  recent.forEach((observation, index) => {
    const observationCharacters = observation.characterIds || [];
    const overlap = observationCharacters.filter((id) => characterIds.has(id)).length;
    if (!overlap) return;
    const recency = (index + 1) / recent.length;
    penalty += overlap * recency * weight;
  });
  return penalty;
}

function explorationBonusForSituation(situation, stats, weight = 0) {
  if (!weight || !situation) return 0;
  const situationCount = Number((stats.bySituation.get(situation.id) || {}).count || 0);
  const characterCounts = (situation.characterIds || []).map((id) => Number(stats.characterCounts.get(id) || 0));
  const characterExploration = characterCounts.length
    ? average(characterCounts.map((count) => 1 / (1 + count)))
    : 1;
  return weight * average([1 / (1 + situationCount), characterExploration]);
}

function retryBonusForSituation(situation, stats, weight = 0) {
  if (!weight || !situation) return 0;
  const item = stats.bySituation.get(situation.id);
  if (!item || !item.count) return 0;
  const averageObserved = item.total / item.count;
  if (averageObserved > 0) return 0;
  return weight / (1 + item.count);
}

function scoreFeedDebugSummary({ catalog, scores }) {
  const situations = activeSituations(catalog);
  const scoreBySituation = new Map((scores || []).map((score) => [score.situationId, score]));
  const topSituations = situations
    .map((situation) => ({
      id: situation.id,
      title: situation.title || situation.name || situation.id,
      score: safeNumber((scoreBySituation.get(situation.id) || {}).predictedScore, 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const labelScores = new Map();
  const characterScores = new Map();
  for (const situation of situations) {
    const score = safeNumber((scoreBySituation.get(situation.id) || {}).predictedScore, 0);
    for (const labelId of situation.labelIds || []) {
      const current = labelScores.get(labelId) || { total: 0, count: 0 };
      current.total += score;
      current.count += 1;
      labelScores.set(labelId, current);
    }
    for (const characterId of situation.characterIds || []) {
      const current = characterScores.get(characterId) || { total: 0, count: 0 };
      current.total += score;
      current.count += 1;
      characterScores.set(characterId, current);
    }
  }

  const labelsById = new Map(((catalog && catalog.labels) || []).map((item) => [item.id, item]));
  const charactersById = new Map(((catalog && catalog.characters) || []).map((item) => [item.id, item]));
  const topFromMap = (map, byId) => Array.from(map.entries())
    .map(([id, item]) => ({
      id,
      name: (byId.get(id) && (byId.get(id).name || byId.get(id).title)) || id,
      score: rounded(item.total / Math.max(1, item.count), 4),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    topSituations,
    topLabels: topFromMap(labelScores, labelsById),
    topCharacters: topFromMap(characterScores, charactersById),
  };
}

function buildScoreFeed({
  showRunId,
  catalog,
  observations = [],
  liveObservation = null,
  config = defaultAlgorithmConfig(),
}) {
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const situations = activeSituations(catalog);
  const observedBySituation = new Map();
  for (const observation of observations) {
    observedBySituation.set(observation.situationId, observation);
  }
  const latestObservation = liveObservation || (observations.length ? observations[observations.length - 1] : null);
  const latestIsLive = !!liveObservation;
  const padVoorgangers = (catalog && catalog.padVoorgangers && typeof catalog.padVoorgangers === "object") ? catalog.padVoorgangers : {};
  const observedSituation = latestObservation
    ? situationById(catalog, latestObservation.situationId)
    : null;
  const stats = observationStats(observations);
  const runProfile = buildRunProfile(observations, liveObservation, normalizedConfig);

  const scores = situations.map((situation) => {
    const observation = observedBySituation.get(situation.id);
    const observedScore = observation ? observation.observedScore : null;
    const liveScore = liveObservation && liveObservation.situationId === situation.id
      ? liveObservation.observedScore
      : null;
    let predictedScore = safeNumber(normalizedConfig.neutralPredictedScore, 0);
    const components = {
      neutral: safeNumber(normalizedConfig.neutralPredictedScore, 0),
      observed: observedScore,
      liveAudience: liveScore,
      latestObservation: 0,
      affinity: 0,
      profileLabel: 0,
      profileCharacter: 0,
      profileSituation: 0,
      profileLabelAffinity: 0,
      profileCharacterAffinity: 0,
      diversityPenalty: 0,
      explorationBonus: 0,
      retryBonus: 0,
      sceneRepeatPenalty: 0,
      labelVoorkeur: 0,
      personageVoorkeur: 0,
      padVoorkeur: 0,
    };
    const reasons = [];
    // Padvoorkeur: de beste score van een gespeelde scène die in een pad direct hiervoor komt.
    const voorgangerScores = ((padVoorgangers[situation.id]) || [])
      .map((id) => observedBySituation.get(id))
      .filter((item) => item && Number.isFinite(Number(item.observedScore)))
      .map((item) => Number(item.observedScore));
    const padVoorkeur = voorgangerScores.length
      ? Math.max(...voorgangerScores) * safeNumber(normalizedConfig.weights.padVolgende, 0.5)
      : 0;
    const labelProfile = profileAverageForIds(runProfile.labels, situation.labelIds || []);
    const characterProfile = profileAverageForIds(runProfile.characters, situation.characterIds || []);
    const situationProfile = profileEntryValue(runProfile.situations.get(situation.id));
    const labelAffinity = labelProfile * safeNumber(normalizedConfig.weights.labelAffinity, 0.25);
    const characterAffinity = characterProfile * safeNumber(normalizedConfig.weights.characterAffinity, 0.15);
    components.profileLabel = rounded(labelProfile, 4);
    components.profileCharacter = rounded(characterProfile, 4);
    components.profileSituation = rounded(situationProfile, 4);
    components.profileLabelAffinity = rounded(labelAffinity, 4);
    components.profileCharacterAffinity = rounded(characterAffinity, 4);
    components.affinity = rounded(labelAffinity + characterAffinity, 4);
    predictedScore += labelAffinity + characterAffinity;
    const voorkeur = profileAverageForIds(runProfile.labelVoorkeur, situation.labelIds || [])
      * safeNumber(normalizedConfig.weights.labelVoorkeur, 1);
    components.labelVoorkeur = rounded(voorkeur, 4);
    predictedScore += voorkeur;
    if (voorkeur !== 0) reasons.push("publiek_label_voorkeur");
    // Personages waar het publiek op stemde: hun aandeel opgeteld (een scène met twee favorieten krijgt beide).
    const personageVoorkeur = (situation.characterIds || [])
      .map((id) => runProfile.personageVoorkeur.get(id))
      .filter((entry) => entry && entry.weight > 0)
      .reduce((som, entry) => som + vervaagdeWaarde(entry), 0)
      * safeNumber(normalizedConfig.weights.personageVoorkeur, 1);
    components.personageVoorkeur = rounded(personageVoorkeur, 4);
    predictedScore += personageVoorkeur;
    if (personageVoorkeur !== 0) reasons.push("publiek_personage_voorkeur");
    components.padVoorkeur = rounded(padVoorkeur, 4);
    predictedScore += padVoorkeur;
    if (padVoorkeur !== 0) reasons.push("publiek_pad_voorkeur");
    if (labelProfile !== 0) reasons.push("profile_label_affinity");
    if (characterProfile !== 0) reasons.push("profile_character_affinity");
    if (runProfile.includesLive && (
      profileLiveWeightForIds(runProfile.labels, situation.labelIds || []) > 0
      || profileLiveWeightForIds(runProfile.characters, situation.characterIds || []) > 0
      || (runProfile.situations.get(situation.id) || {}).liveWeight > 0
    )) {
      reasons.push("live_audience_profile");
    }
    if (liveScore != null) {
      predictedScore = liveScore;
      reasons.length = 0;
      reasons.push("live_audience_signals");
    }
    if (observation) {
      predictedScore = observation.observedScore;
      reasons.length = 0;
      reasons.push("observed");
      if (observation.finalizedFromAudienceAggregate) reasons.push("finalized_from_audience_aggregate");
      if (observation.finalizedFromLiveAudience) reasons.push("finalized_from_live_audience");
    }
    components.diversityPenalty = rounded(recentCharacterPenalty(
      situation,
      observations,
      safeNumber(normalizedConfig.weights.diversity, 0)
    ), 4);
    components.explorationBonus = rounded(explorationBonusForSituation(
      situation,
      stats,
      safeNumber(normalizedConfig.weights.exploration, 0)
    ), 4);
    components.retryBonus = rounded(retryBonusForSituation(
      situation,
      stats,
      safeNumber(normalizedConfig.weights.retry, 0)
    ), 4);
    const runCount = Number((stats.bySituation.get(situation.id) || {}).count || 0);
    components.sceneRepeatPenalty = rounded(
      runCount > 0 ? safeNumber(normalizedConfig.weights.sceneRepeatPenalty, 0) : 0,
      4
    );
    predictedScore = predictedScore
      - components.diversityPenalty
      + components.explorationBonus
      + components.retryBonus
      - components.sceneRepeatPenalty;
    if (components.diversityPenalty > 0) reasons.push("diversity_penalty");
    if (components.explorationBonus > 0) reasons.push("exploration_bonus");
    if (components.retryBonus > 0) reasons.push("retry_bonus");
    if (components.sceneRepeatPenalty > 0) reasons.push("scene_repeat_penalty");
    if (!reasons.length) {
      reasons.push(latestObservation
        ? latestIsLive ? "predicted_from_live_audience_signals" : "predicted_from_latest_observation"
        : "neutral");
    }
    components.final = rounded(predictedScore, 4);
    return {
      situationId: situation.id,
      legacySituationId: situation.legacyId || null,
      observedScore,
      predictedScore: rounded(predictedScore, 4),
      confidence: observation ? 0.8 : liveScore != null ? 0.55 : latestObservation ? latestIsLive ? 0.35 : 0.45 : 0.1,
      reasons,
      components,
    };
  });

  const feed = {
    type: "situationScoresUpdated",
    schemaVersion: ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
    showRunId,
    scorePhase: liveObservation ? "live" : "definitive",
    updatedAt: new Date().toISOString(),
    updatedAfterSituationRunId: latestObservation ? latestObservation.situationRunId : null,
    scores,
  };
  feed.debugSummary = scoreFeedDebugSummary({ catalog, scores });
  return feed;
}

// Hoe sterk het algoritme nu naar elk label trekt: wat het profiel van dit publiek per label optelt
// bij een scène met dat label (reacties op scènes met het label × gewicht, plus de labelvraag × gewicht).
// Het procent is die trek tegenover het label dat het sterkst trekt (dat label = 100%, niets of
// negatief = 0%). Zo staat er op het scherm wat de keuze van de volgende scènes echt stuurt.
function labelTrek({ catalog, observations = [], liveObservation = null, config = defaultAlgorithmConfig() }) {
  const normalizedConfig = normalizeAlgorithmConfig(config);
  const weights = normalizedConfig.weights || {};
  const runProfile = buildRunProfile(observations, liveObservation, normalizedConfig);
  const labels = ((catalog && catalog.labels) || []).filter((label) => label && label.active !== false);
  const rijen = labels.map((label) => {
    const reacties = profileEntryValue(runProfile.labels.get(label.id)) * safeNumber(weights.labelAffinity, 0.25);
    const vraag = profileEntryValue(runProfile.labelVoorkeur.get(label.id)) * safeNumber(weights.labelVoorkeur, 1);
    return {
      id: label.id,
      name: label.name || label.id,
      trek: rounded(reacties + vraag, 4),
      reacties: rounded(reacties, 4),
      vraag: rounded(vraag, 4),
      gezien: (runProfile.labels.get(label.id) || {}).count || 0,
    };
  });
  const hoogste = Math.max(0, ...rijen.map((rij) => rij.trek));
  for (const rij of rijen) rij.procent = hoogste > 0 ? Math.round((Math.max(0, rij.trek) / hoogste) * 100) : 0;
  return rijen.sort((a, b) => b.trek - a.trek);
}

// Favoriete personages volgens de stemmen na de scène: gemiddeld aandeel van de stemmen.
function personageFavorieten({ observations = [], config = defaultAlgorithmConfig() }) {
  const runProfile = buildRunProfile(observations, null, normalizeAlgorithmConfig(config));
  return [...runProfile.personageVoorkeur.entries()]
    .map(([characterId, entry]) => ({ characterId, aandeel: rounded(vervaagdeWaarde(entry), 4), rondes: entry.count }))
    .filter((rij) => rij.aandeel > 0)
    .sort((a, b) => b.aandeel - a.aandeel || b.rondes - a.rondes);
}

module.exports = {
  padVoorgangersUitPaden,
  personageVoorkeurWaarden,
  recencyWeightForObservation,
  vervaagdeWaarde,
  labelTrek,
  personageFavorieten,
  activeSituations,
  buildScoreFeed,
  catalogFromRunSnapshot,
  defaultAlgorithmConfig,
  durationFactor,
  audienceFactor,
  normalizeAlgorithmConfig,
  observedScoreForEvent,
  personagesUitCatalogus,
  scoreOnderdelen,
  roomSoundLift,
  cameraMoments,
  cameraPoints,
  scoreFeedDebugSummary,
  signalCounts,
};
