"use strict";

const assert = require("node:assert/strict");

const {
  GATEWAY_SERVICE_KEYS,
  validateGatewayStatusShape,
} = require("../../shared/contracts/gateway-v0");
const {
  buildGatewayStatus,
  forwardJson,
  routeManifest,
} = require("../client/service-clients");

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function main() {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url, method: options.method || "GET", body: options.body || null });
    if (url.endsWith("/health")) {
      const service = url.match(/:(\d+)/)[1];
      return response({ ok: true, service: `service-${service}`, version: "v0", port: Number(service) });
    }
    return response({ ok: true, forwardedUrl: url, method: options.method || "GET" });
  };

  const status = await buildGatewayStatus(fetchImpl);
  assert.equal(validateGatewayStatusShape(status).length, 0);
  assert.equal(status.services.length, GATEWAY_SERVICE_KEYS.length);
  assert.equal(status.ok, true);
  assert.equal(seen.filter((call) => call.url.endsWith("/health")).length, GATEWAY_SERVICE_KEYS.length);

  const routes = routeManifest();
  assert(routes.routes.some((route) => route.forwardsTo.startsWith("runtime:")));
  assert(routes.routes.some((route) => route.forwardsTo.startsWith("show-control:")));
  assert(!JSON.stringify(routes).includes("pathLocked"));
  assert(!JSON.stringify(routes).includes("preparedNext"));

  const forwarded = await forwardJson("runtime", "/v0/runtime/runs/start", { method: "POST", body: {} }, fetchImpl);
  assert.equal(forwarded.ok, true);
  assert(seen.some((call) => call.url.endsWith("/v0/runtime/runs/start") && call.method === "POST"));

  process.stdout.write(JSON.stringify({
    ok: true,
    serviceCount: status.services.length,
    routeCount: routes.routes.length,
    assertions: [
      "Gateway status fans out to all module health endpoints",
      "Gateway command routing forwards to Runtime",
      "Gateway route manifest contains no domain decision fields",
    ],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
