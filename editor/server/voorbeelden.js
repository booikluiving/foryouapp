"use strict";

// Small previews of the image catalog's pictures for its overview, which otherwise loads every
// original (PNGs of 5 MB) over the NAS's home connection. Each is made once, on its first
// request, and kept in a folder that may be thrown away at any time (a tmpfs in the container).

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// A media id ends in the first 16 hex characters of its file's SHA-256, so its bytes never change.
const CONTENT_ID = /-[0-9a-f]{16}$/;
// Sharp enough for an overview card of about 570 px on a retina screen.
const WIDTH = 1200;
// Larger originals are not read into memory for a preview.
const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
// At most this many are made at once, so a first visit does not take all of the NAS's CPU.
const AT_ONCE = 2;

function createVoorbeelden({ catalogUrl, dir = path.join(os.tmpdir(), "foryou-voorbeelden"), width = WIDTH } = {}) {
  const folder = path.resolve(dir);
  const making = new Map();
  // Ids without a preview (not a picture, or one that cannot be read) until the next start.
  const without = new Set();
  const waiting = [];
  let running = 0;
  let sharp = null;

  function next() {
    while (running < AT_ONCE && waiting.length) {
      running += 1;
      waiting.shift()();
    }
  }

  function inTurn(task) {
    return new Promise((resolve, reject) => {
      waiting.push(() => task().then(resolve, reject).finally(() => {
        running -= 1;
        next();
      }));
      next();
    });
  }

  async function make(assetId, file) {
    const response = await fetch(`${catalogUrl}/v0/catalog/media-assets/file/${encodeURIComponent(assetId)}`, { signal: AbortSignal.timeout(60000) });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.startsWith("image/") || Number(response.headers.get("content-length") || 0) > MAX_SOURCE_BYTES) {
      if (response.body) await response.body.cancel();
      return null;
    }
    sharp = sharp || require("sharp");
    // rotate() follows the camera's orientation, as the browser does with the original.
    const picture = await sharp(Buffer.from(await response.arrayBuffer()), { animated: false })
      .rotate()
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    fs.mkdirSync(folder, { recursive: true });
    const temp = `${file}.${crypto.randomBytes(6).toString("hex")}`;
    fs.writeFileSync(temp, picture);
    fs.renameSync(temp, file);
    return file;
  }

  // The path of this picture's preview, or null when it has none: then the original is used.
  return async function voorbeeld(assetId) {
    if (!CONTENT_ID.test(assetId) || without.has(assetId)) return null;
    const file = path.join(folder, `${crypto.createHash("sha256").update(assetId).digest("hex").slice(0, 32)}-${width}.webp`);
    if (fs.existsSync(file)) return file;
    if (!making.has(assetId)) {
      making.set(assetId, inTurn(() => make(assetId, file))
        .catch((err) => {
          process.stderr.write(`voorbeeld: ${assetId}: ${err && err.message ? err.message : err}\n`);
          return null;
        })
        .then((made) => {
          if (!made) without.add(assetId);
          making.delete(assetId);
          return made;
        }));
    }
    return making.get(assetId);
  };
}

module.exports = { CONTENT_ID, createVoorbeelden };
