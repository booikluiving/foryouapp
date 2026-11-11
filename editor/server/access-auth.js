"use strict";

const { createPublicKey, verify } = require("node:crypto");

// Second lock behind Cloudflare Access (same approach as the Snipe-IT gate): every
// request must carry a valid Access JWT. Team members are known by their e-mail,
// the show Mac by the client id of its service token.

const KEY_REFRESH_MS = 60 * 60 * 1000;
const UNKNOWN_KID_RETRY_MS = 10 * 1000;
const CLOCK_SKEW_SECONDS = 60;

function createAccessVerifier({ teamDomain, audiences, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const issuer = `https://${teamDomain}`;
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  const allowedAudiences = new Set((audiences || []).filter(Boolean));
  let keysByKid = new Map();
  let fetchedAt = 0;
  let pendingFetch = null;

  async function refreshKeys() {
    pendingFetch = pendingFetch || (async () => {
      try {
        const response = await fetchImpl(certsUrl, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { keys = [] } = await response.json();
        const next = new Map();
        for (const jwk of keys) {
          if (jwk.kid && jwk.kty === "RSA") next.set(jwk.kid, createPublicKey({ format: "jwk", key: jwk }));
        }
        keysByKid = next;
      } finally {
        fetchedAt = now();
        pendingFetch = null;
      }
    })();
    return pendingFetch;
  }

  async function keyFor(kid) {
    const age = now() - fetchedAt;
    if (!fetchedAt || age > KEY_REFRESH_MS || (!keysByKid.has(kid) && age > UNKNOWN_KID_RETRY_MS)) {
      try {
        await refreshKeys();
      } catch (err) {
        console.error(`Access-sleutels ophalen mislukt: ${err.message}`);
      }
    }
    return keysByKid.get(kid) || null;
  }

  return async function verifyAccessToken(token) {
    if (!teamDomain || !allowedAudiences.size) return { ok: false, reason: "Access niet ingesteld op de server" };
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return { ok: false, reason: "geen Access-JWT" };
    let header;
    let payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch (_err) {
      return { ok: false, reason: "onleesbare JWT" };
    }
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "verkeerd algoritme" };
    const key = await keyFor(header.kid);
    if (!key) return { ok: false, reason: "onbekende sleutel" };
    const signed = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
    if (!signed) return { ok: false, reason: "ongeldige handtekening" };
    if (!payload || payload.iss !== issuer) return { ok: false, reason: "verkeerde issuer" };
    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!tokenAudiences.some((aud) => allowedAudiences.has(aud))) return { ok: false, reason: "verkeerde aud" };
    const nowSeconds = now() / 1000;
    if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) return { ok: false, reason: "verlopen" };
    if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > nowSeconds) return { ok: false, reason: "nog niet geldig" };
    return {
      ok: true,
      email: typeof payload.email === "string" ? payload.email.toLowerCase() : "",
      serviceClientId: typeof payload.common_name === "string" ? payload.common_name : "",
    };
  };
}

module.exports = {
  createAccessVerifier,
};
