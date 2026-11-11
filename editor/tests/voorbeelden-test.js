"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const { createVoorbeelden } = require("../server/voorbeelden");

// A photo-like picture (noise, so it does not compress to nothing) of the size of the slowest originals.
async function picture(width, height, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = crypto.randomBytes(width * height * channels);
  return sharp(raw, { raw: { width, height, channels } }).png({ compressionLevel: 1 }).toBuffer();
}

async function main() {
  const files = {
    "media-asset:environment:1:background:studio-0123456789abcdef": { type: "image/png", body: await picture(3105, 1920) },
    "media-asset:environment:1:fxImage:raam-1111111111111111": { type: "image/png", body: await picture(800, 600, { alpha: true }) },
    "media-asset:environment:1:soundscape:zee-2222222222222222": { type: "audio/mpeg", body: Buffer.from("ID3 geen beeld") },
    "media-asset:environment:1:background:kapot-3333333333333333": { type: "image/png", body: Buffer.from("geen png") },
  };
  const asked = [];
  const catalog = http.createServer((req, res) => {
    const id = decodeURIComponent(req.url.split("/").pop());
    asked.push(id);
    const file = files[id];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": file.type, "content-length": file.body.length }).end(file.body);
  });
  await new Promise((resolve) => catalog.listen(0, "127.0.0.1", resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voorbeelden-"));
  const voorbeeld = createVoorbeelden({ catalogUrl: `http://127.0.0.1:${catalog.address().port}`, dir });

  const logged = [];
  const quiet = process.stderr.write.bind(process.stderr);
  process.stderr.write = (text) => { logged.push(String(text)); return true; };
  try {
    // A large PNG becomes a WebP of 1200 px wide that is a fraction of the original.
    const studio = "media-asset:environment:1:background:studio-0123456789abcdef";
    const [first, second, third] = await Promise.all([voorbeeld(studio), voorbeeld(studio), voorbeeld(studio)]);
    assert.ok(first && first === second && second === third);
    assert.equal(asked.filter((id) => id === studio).length, 1, "three requests at once fetch the original once");
    const made = await sharp(first).metadata();
    assert.equal(made.format, "webp");
    assert.equal(made.width, 1200);
    assert.equal(made.height, Math.round(1920 * 1200 / 3105));
    assert.ok(fs.statSync(first).size < files[studio].body.length / 5, `${fs.statSync(first).size} bytes`);

    // Made once: a later request (also after a restart, with the same folder) takes the file.
    assert.equal(await voorbeeld(studio), first);
    assert.equal(await createVoorbeelden({ catalogUrl: "http://127.0.0.1:9", dir })(studio), first);
    assert.equal(asked.filter((id) => id === studio).length, 1);

    // A small picture is not made larger, and keeps its transparency.
    const raam = await sharp(await voorbeeld("media-asset:environment:1:fxImage:raam-1111111111111111")).metadata();
    assert.equal(raam.width, 800);
    assert.equal(raam.hasAlpha, true);

    // No preview, so the original is used: not a picture, unreadable, unknown, or an id without a content hash.
    assert.equal(await voorbeeld("media-asset:environment:1:soundscape:zee-2222222222222222"), null);
    assert.equal(await voorbeeld("media-asset:environment:1:background:kapot-3333333333333333"), null);
    assert.ok(logged.some((line) => line.includes("kapot-3333333333333333")));
    assert.equal(await voorbeeld("media-asset:environment:1:background:weg-4444444444444444"), null);
    const before = asked.length;
    assert.equal(await voorbeeld("media-asset:environment:1:background:zonder-hash"), null);
    // And once without, it is not tried again until the next start.
    assert.equal(await voorbeeld("media-asset:environment:1:background:kapot-3333333333333333"), null);
    assert.equal(asked.length, before);
  } finally {
    process.stderr.write = quiet;
    catalog.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("voorbeelden: 18 controles OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
