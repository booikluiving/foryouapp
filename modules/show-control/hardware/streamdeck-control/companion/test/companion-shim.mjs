// Wordt met `node --import` in de test-Companion geladen (zie deck.sh test).
// Companion 4.3 opent een paar vaste poorten op alle netwerkkaarten ("::"):
// satellite tcp 16622 en websocket 16623. Die heeft de echte Companion van for_you ook nodig.
// Deze shim verschuift ze (+1000) en laat elke listener alleen op 127.0.0.1 luisteren.
import net from "node:net";
import dgram from "node:dgram";

const REMAP = { 16622: 17622, 16623: 17623 };
const LOCAL = "127.0.0.1";
const KEEP = new Set([5353]); // mDNS (Bonjour-browse, alleen luisteren) moet op de wildcard blijven
const isWild = (h) => h === undefined || h === null || h === "" || h === "::" || h === "0.0.0.0";

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const a0 = args[0];
  if (a0 && typeof a0 === "object" && !Array.isArray(a0) && "port" in a0) {
    const opts = { ...a0 };
    if (REMAP[opts.port]) opts.port = REMAP[opts.port];
    if (isWild(opts.host)) opts.host = LOCAL;
    args[0] = opts;
  } else if (typeof a0 === "number" || (typeof a0 === "string" && /^\d+$/.test(a0))) {
    const port = Number(a0);
    args[0] = REMAP[port] || port;
    if (typeof args[1] === "string") {
      if (isWild(args[1])) args[1] = LOCAL;
    } else {
      args.splice(1, 0, LOCAL);
    }
  }
  return listen.apply(this, args);
};

const bind = dgram.Socket.prototype.bind;
dgram.Socket.prototype.bind = function (...args) {
  const a0 = args[0];
  if (a0 && typeof a0 === "object") {
    const opts = { ...a0 };
    if (opts.port && !KEEP.has(Number(opts.port)) && isWild(opts.address)) opts.address = LOCAL;
    args[0] = opts;
  } else if (typeof a0 === "number" && a0 > 0 && !KEEP.has(a0)) {
    if (typeof args[1] === "string") {
      if (isWild(args[1])) args[1] = LOCAL;
    } else {
      args.splice(1, 0, LOCAL);
    }
  }
  return bind.apply(this, args);
};
