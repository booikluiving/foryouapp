const http = require("http");
const osc = require("osc");

const targetPort = Number(process.env.SQ5_OSC_PORT || 53000);
const statusUrl = new URL(process.env.SQ5_TEST_STATUS_URL || "http://127.0.0.1:3105/api/status");

function getStatus() {
  return new Promise((resolve, reject) => {
    const req = http.get(statusUrl, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
  });
}

async function main() {
  const port = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: 0,
    metadata: true,
  });

  await new Promise((resolve, reject) => {
    port.on("ready", resolve);
    port.on("error", reject);
    port.open();
  });

  port.send(
    {
      address: "/sq/input/booi/level",
      args: [{ type: "f", value: -20 }],
    },
    "127.0.0.1",
    targetPort
  );

  await new Promise((resolve) => setTimeout(resolve, 250));
  port.close();

  const status = await getStatus();
  const match = (status.activity || []).find((entry) => entry.source === "osc" && entry.channel === "Booi" && entry.action === "level" && entry.hex);
  if (!match) throw new Error("OSC loopback entry niet gevonden in bridge-log");
  console.log(`OSC loopback ok: ${match.hex}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
