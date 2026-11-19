"use strict";

// Rekent de indeling van het universum in een eigen thread (zie telefoon-kaart.js).

const { parentPort, workerData } = require("node:worker_threads");
const { telefoonIndeling } = require("./telefoon-indeling");

const uitkomst = telefoonIndeling(workerData.graph);
const posities = {};
for (const [sceneId, punt] of uitkomst.pos) posities[sceneId] = [punt.x, punt.y];
const bochten = {};
for (const [sleutel, punten] of uitkomst.bochten || []) bochten[sleutel] = punten;
const stralen = Object.fromEntries(uitkomst.stralen || []);
const dikten = Object.fromEntries(uitkomst.dikten || []);
parentPort.postMessage({ bron: uitkomst.bron, fout: uitkomst.fout || null, posities, bochten, stralen, dikten });
