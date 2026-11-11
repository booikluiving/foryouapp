"use strict";

const crypto = require("node:crypto");

// Key order must not change a hash, so objects are written with sorted keys.
function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function hashJson(value) {
  return sha256Hex(stableStringify(value));
}

function isLoopbackAddress(address) {
  const value = String(address || "");
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

// Bulk content routes replace a whole store, so only processes on the same machine may call them.
function loopbackOnly(req, res, next) {
  if (isLoopbackAddress(req.socket && req.socket.remoteAddress)) return next();
  res.status(403).json({ ok: false, error: "loopback_only" });
}

// All writes of one service run one after another, so a read-modify-write never
// works on a store that another request is still changing.
function createWriteQueue() {
  let tail = Promise.resolve();
  return function writeQueue(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      release();
    };
    res.on("finish", done);
    res.on("close", done);
    previous.then(() => next(), () => next());
  };
}

module.exports = {
  createWriteQueue,
  hashJson,
  isLoopbackAddress,
  loopbackOnly,
  sha256Hex,
  stableStringify,
};
