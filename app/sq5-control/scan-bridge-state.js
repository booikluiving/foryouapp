#!/usr/bin/env node

const http = require("http");

const baseUrl = new URL(process.env.SQ5_BRIDGE_URL || process.argv[2] || "http://127.0.0.1:3105");
const requested = process.argv.slice(3);

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = JSON.stringify(body || {});
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let response = "";
        res.on("data", (chunk) => {
          response += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(response || "{}");
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readInput(input) {
  const level = await postJson(`/api/input/${input}/get`, { parameter: "level", destination: "lr" });
  await delay(20);
  const mute = await postJson(`/api/input/${input}/get`, { parameter: "mute" });
  await delay(20);
  return {
    kind: "input",
    token: `input${input}`,
    label: `Input ${input}`,
    mute: mute.decoded ? mute.decoded.value : null,
    levelDb: level.decoded ? Number(level.decoded.value.toFixed(1)) : null,
  };
}

async function readOutput(token) {
  const level = await postJson(`/api/output/${token}/get`, { parameter: "level" }).catch((error) => ({ error: error.message }));
  await delay(20);
  const mute = await postJson(`/api/output/${token}/get`, { parameter: "mute" }).catch((error) => ({ error: error.message }));
  await delay(20);
  return {
    kind: "output",
    token,
    label: level.channel || mute.channel || token,
    mute: mute.decoded ? mute.decoded.value : null,
    levelDb: level.decoded ? Number(level.decoded.value.toFixed(1)) : null,
    error: level.error || mute.error || "",
  };
}

function inRange(value, min, max) {
  return typeof value === "number" && value >= min && value <= max;
}

function printSection(title, rows) {
  console.log(`\n${title}`);
  console.table(rows.map((row) => ({
    kind: row.kind,
    token: row.token,
    label: row.label,
    mute: row.mute,
    levelDb: row.levelDb,
    error: row.error || "",
  })));
}

async function main() {
  const outputTokens = requested.length
    ? requested
    : [
        "main",
        "mics",
        "muziek",
        ...Array.from({ length: 12 }, (_, index) => `group${index + 1}`),
        ...Array.from({ length: 12 }, (_, index) => `aux${index + 1}`),
        ...Array.from({ length: 3 }, (_, index) => `mtx${index + 1}`),
        ...Array.from({ length: 8 }, (_, index) => `dca${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `fxsend${index + 1}`),
        ...Array.from({ length: 8 }, (_, index) => `fxreturn${index + 1}`),
      ];

  const outputs = [];
  for (const token of outputTokens) outputs.push(await readOutput(token));

  const inputs = [];
  for (let input = 1; input <= 48; input += 1) inputs.push(await readInput(input));

  printSection("Outputs", outputs);
  printSection("Inputs actief/niet -inf", inputs.filter((row) => row.mute || inRange(row.levelDb, -89, 10)));

  const all = outputs.concat(inputs).filter((row) => typeof row.levelDb === "number");
  printSection("Kandidaten Sub (-40..-30)", all.filter((row) => inRange(row.levelDb, -40, -30)));
  printSection("Kandidaten Main (-30..-20)", all.filter((row) => inRange(row.levelDb, -30, -20)));
  printSection("Kandidaten Mac/Studio (-20..-10)", all.filter((row) => inRange(row.levelDb, -20, -10)));
  printSection("Kandidaten MiniJack (-10..-5)", all.filter((row) => inRange(row.levelDb, -10, -5)));
  printSection("Kandidaten Mics (-5..0)", all.filter((row) => inRange(row.levelDb, -5, 0)));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
