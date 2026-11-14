"use strict";

// Slot op de proefshow. Wordt vóór elk onderdeel van de proefshow geladen (node --require).
// De proefshow mag alleen praten met zijn eigen onderdelen op deze computer en met de taalmodellen.
// Elke andere verbinding (de echte show, apparaten, andere computers) wordt geweigerd, zodat een
// proef nooit een cue naar de zaal of een wijziging naar de website kan sturen.

const net = require("node:net");
const dgram = require("node:dgram");

const POORTEN = new Set(String(process.env.PROEF_POORTEN || "").split(",").map(Number).filter(Boolean));
const HOSTS = new Set(String(process.env.PROEF_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
const LUS = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1", ""]);
const gemeld = new Set();

function mag(host, port) {
  const naam = String(host == null ? "" : host).toLowerCase();
  if (LUS.has(naam)) return POORTEN.has(Number(port));
  return HOSTS.has(naam);
}

function meld(soort, host, port) {
  const sleutel = `${soort} ${host}:${port}`;
  if (gemeld.has(sleutel)) return;
  gemeld.add(sleutel);
  process.stderr.write(`proef-slot: ${process.env.PROEF_NAAM || "onderdeel"} wilde naar ${sleutel}, geweigerd\n`);
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function proefConnect(...args) {
  let opties = args[0];
  if (Array.isArray(opties)) opties = opties[0];
  let host;
  let port;
  if (opties && typeof opties === "object") {
    if (opties.path) return connect.apply(this, args);
    host = opties.host;
    port = opties.port;
  } else {
    port = args[0];
    host = typeof args[1] === "string" ? args[1] : "";
  }
  if (mag(host, port)) return connect.apply(this, args);
  meld("tcp", host || "127.0.0.1", port);
  const fout = Object.assign(new Error(`proef-slot: verbinding met ${host || "127.0.0.1"}:${port} geweigerd`), { code: "ECONNREFUSED" });
  process.nextTick(() => this.destroy(fout));
  return this;
};

const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function proefSend(...args) {
  // send(msg, [offset, length,] port, [address,] [callback])
  const getallen = args.filter((arg) => typeof arg === "number");
  const port = getallen.length >= 3 ? getallen[2] : getallen[0];
  const host = args.find((arg, index) => index > 0 && typeof arg === "string") || "127.0.0.1";
  if (mag(host, port)) return send.apply(this, args);
  meld("udp", host, port);
  const terug = args.find((arg) => typeof arg === "function");
  if (terug) process.nextTick(() => terug(null, 0));
  return undefined;
};
