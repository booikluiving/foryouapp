"use strict";

// Rekent de indeling van het universum in een eigen thread (zie telefoon-kaart.js).

const { parentPort, workerData } = require("node:worker_threads");
const { telefoonIndeling } = require("./telefoon-indeling");

const uitkomst = telefoonIndeling(workerData.graph);
const posities = {};
for (const [sceneId, punt] of uitkomst.pos) posities[sceneId] = [punt.x, punt.y];
parentPort.postMessage({ bron: uitkomst.bron, fout: uitkomst.fout || null, posities });
