"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createAccessVerifier } = require("../server/access-auth");

const TEAM = "proef.cloudflareaccess.com";
const AUD = "aud-voorstelling";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };

function token(payload, key = privateKey, kid = "k1") {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = `${part({ alg: "RS256", kid })}.${part(payload)}`;
  return `${head}.${crypto.sign("sha256", Buffer.from(head), key).toString("base64url")}`;
}

(async () => {
  let fetches = 0;
  const verify = createAccessVerifier({
    teamDomain: TEAM,
    audiences: [AUD],
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    },
  });
  const now = Math.floor(Date.now() / 1000);
  const base = { iss: `https://${TEAM}`, aud: [AUD], exp: now + 600 };

  const person = await verify(token({ ...base, email: "Booi@Example.nl" }));
  assert.equal(person.ok, true);
  assert.equal(person.email, "booi@example.nl");
  const service = await verify(token({ ...base, common_name: "abc.access" }));
  assert.equal(service.ok, true);
  assert.equal(service.serviceClientId, "abc.access");
  assert.equal((await verify(token({ ...base, aud: ["andere-app"], email: "x@y.nl" }))).ok, false);
  assert.equal((await verify(token({ ...base, iss: "https://ander.cloudflareaccess.com", email: "x@y.nl" }))).ok, false);
  assert.equal((await verify(token({ ...base, exp: now - 3600, email: "x@y.nl" }))).ok, false);
  assert.equal((await verify(token({ ...base, email: "x@y.nl" }, other.privateKey))).reason, "ongeldige handtekening");
  assert.equal((await verify("geen.token")).ok, false);
  assert.equal((await verify(token({ ...base, email: "x@y.nl" }, privateKey, "onbekend"))).reason, "onbekende sleutel");
  const unconfigured = createAccessVerifier({ teamDomain: TEAM, audiences: [] });
  assert.equal((await unconfigured(token({ ...base, email: "x@y.nl" }))).ok, false);
  assert.ok(fetches >= 1);
  console.log("access-auth: 9 controles OK");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
