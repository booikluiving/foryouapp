"use strict";

function tryRequire(moduleId) {
  try {
    return { value: require(moduleId) };
  } catch (error) {
    return { error };
  }
}

function loadWs() {
  const candidates = [
    process.env.V2_AUDIENCE_WS_MODULE,
    "ws",
  ].filter(Boolean);
  const errors = [];
  for (const candidate of candidates) {
    const loaded = tryRequire(candidate);
    if (!loaded.error) return loaded.value;
    errors.push(`${candidate}: ${loaded.error.message}`);
  }
  throw new Error(`audience_ws_module_unavailable:${errors.join(" | ")}`);
}

function loadSocketIo() {
  const candidates = [
    process.env.V2_AUDIENCE_SOCKET_IO_MODULE,
    "socket.io",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const loaded = tryRequire(candidate);
    if (!loaded.error) return loaded.value.Server || loaded.value;
  }
  return null;
}

module.exports = {
  loadSocketIo,
  loadWs,
};
