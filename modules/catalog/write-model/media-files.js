"use strict";

// Media files for the website sync: what is here, with which SHA-256, and putting a file
// in place safely. Files are only ever added: a file that exists with other content is
// never overwritten, and nothing is deleted here.

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const { safeRelativePath } = require("./catalog-content");

function resolveInside(mediaRoot, relativePath) {
  if (!safeRelativePath(relativePath)) return null;
  const resolved = path.resolve(mediaRoot, relativePath);
  const relative = path.relative(mediaRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

async function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

// Hashing 600 MB on every save would be slow; a file with the same size and mtime is
// taken to be unchanged.
function createMediaHashCache() {
  const cache = new Map();
  return async function hashOf(filePath) {
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw err;
    }
    if (!stat.isFile()) return null;
    const key = `${stat.size}:${stat.mtimeMs}`;
    const cached = cache.get(filePath);
    if (cached && cached.key === key) return cached.value;
    const value = { sha256: await sha256OfFile(filePath), sizeBytes: stat.size };
    cache.set(filePath, { key, value });
    return value;
  };
}

// { relativePath: { sha256, sizeBytes } } for every path, or null when the file is missing.
async function describeMediaFiles(relativePaths, mediaRoot, hashOf) {
  const result = {};
  for (const relativePath of relativePaths) {
    const filePath = resolveInside(mediaRoot, relativePath);
    result[relativePath] = filePath ? await hashOf(filePath) : null;
  }
  return result;
}

// Writes `source` (a readable stream) to `relativePath`, but only if its SHA-256 is
// `expectedSha256`. Returns "nieuw" or "al_aanwezig"; throws with a statusCode otherwise.
async function putMediaFile({ mediaRoot, relativePath, expectedSha256, source, hashOf }) {
  const target = resolveInside(mediaRoot, relativePath);
  if (!target) throw Object.assign(new Error("media_pad_ongeldig"), { statusCode: 400 });
  if (!/^[0-9a-f]{64}$/.test(String(expectedSha256 || ""))) throw Object.assign(new Error("sha256_ongeldig"), { statusCode: 400 });
  const existing = await hashOf(target);
  if (existing) {
    // Drain the upload so the connection ends cleanly.
    source.resume();
    if (existing.sha256 === expectedSha256) return "al_aanwezig";
    throw Object.assign(new Error("media_bestaat_met_andere_inhoud"), { statusCode: 409 });
  }
  const tempDir = path.join(mediaRoot, "_sync-tmp");
  await fsp.mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`);
  const hash = crypto.createHash("sha256");
  try {
    const hasher = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(source, hasher, fs.createWriteStream(tempPath, { flags: "wx" }));
    const actual = hash.digest("hex");
    if (actual !== expectedSha256) throw Object.assign(new Error("sha256_klopt_niet"), { statusCode: 422, actual });
    const handle = await fsp.open(tempPath, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(tempPath, target);
    return "nieuw";
  } finally {
    await fsp.unlink(tempPath).catch(() => {});
  }
}

module.exports = {
  createMediaHashCache,
  describeMediaFiles,
  putMediaFile,
  resolveInside,
  sha256OfFile,
};
