"use strict";

const EventEmitter = require("node:events");
const { normalizeIp } = require("./audience-service");
const { loadSocketIo, loadWs } = require("./realtime-loader");

const WebSocket = loadWs();
const SocketIOServer = loadSocketIo();

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function sendJson(client, payload) {
  if (!client || client.readyState !== WebSocket.OPEN) return false;
  try {
    client.send(safeJsonStringify(payload));
    return true;
  } catch {
    return false;
  }
}

function buildSocketIoCompatRequest(socket) {
  const request = socket && socket.request ? socket.request : {};
  const handshake = socket && socket.handshake ? socket.handshake : {};
  const headers = {
    ...(request.headers && typeof request.headers === "object" ? request.headers : {}),
    ...(handshake.headers && typeof handshake.headers === "object" ? handshake.headers : {}),
  };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(handshake.query || {})) {
    if (Array.isArray(value)) {
      for (const entry of value) search.append(String(key), String(entry || ""));
    } else {
      search.append(String(key), String(value || ""));
    }
  }
  const query = search.toString();
  const url = query ? `/v2/audience/socket.io?${query}` : "/v2/audience/socket.io";
  return {
    url,
    headers,
    socket: {
      remoteAddress: normalizeIp(
        handshake.address
        || request.socket && request.socket.remoteAddress
        || socket.conn && socket.conn.remoteAddress
        || "unknown"
      ),
    },
    secure: !!(request.connection && request.connection.encrypted),
  };
}

function createSocketIoCompatClient(socket) {
  const client = new EventEmitter();
  client.readyState = WebSocket.OPEN;
  client.__transport = "socketio";
  client.__pendingCloseCode = 1001;
  client.__pendingCloseReason = "socket.io disconnect";

  client.send = (payload) => {
    if (client.readyState !== WebSocket.OPEN) throw new Error("socket_not_open");
    socket.emit("ws_message", typeof payload === "string" ? payload : safeJsonStringify(payload));
  };

  client.close = (code = 1000, reason = "") => {
    if (client.readyState === WebSocket.CLOSING || client.readyState === WebSocket.CLOSED) return;
    client.__pendingCloseCode = Number(code || 1000);
    client.__pendingCloseReason = String(reason || "").slice(0, 120);
    client.readyState = WebSocket.CLOSING;
    try {
      socket.emit("ws_close", { code: client.__pendingCloseCode, reason: client.__pendingCloseReason });
    } catch {}
    try {
      socket.disconnect(true);
    } catch {}
  };

  socket.on("ws_message", (payload) => {
    if (client.readyState !== WebSocket.OPEN) return;
    client.emit("message", Buffer.from(typeof payload === "string" ? payload : safeJsonStringify(payload), "utf8"));
  });

  socket.on("ws_close", (payload) => {
    if (client.readyState !== WebSocket.OPEN) return;
    client.__pendingCloseCode = Number(payload && payload.code || 1001);
    client.__pendingCloseReason = String(payload && payload.reason || "socket.io client close").slice(0, 120);
    client.readyState = WebSocket.CLOSING;
    try {
      socket.disconnect(true);
    } catch {}
  });

  socket.on("disconnect", (reason) => {
    if (client.readyState === WebSocket.CLOSED) return;
    const code = Number(client.__pendingCloseCode || 1001);
    const reasonText = String(client.__pendingCloseReason || reason || "socket.io disconnect").slice(0, 120);
    client.readyState = WebSocket.CLOSED;
    client.emit("close", code, Buffer.from(reasonText, "utf8"));
  });

  socket.on("error", (err) => client.emit("error", err));
  socket.on("connect_error", (err) => client.emit("error", err));
  return client;
}

function matchesScope(meta, scope) {
  if (!meta || !scope) return false;
  if (scope.kind === "client") return String(meta.clientKey || "") === String(scope.clientKey || "");
  return normalizeIp(meta.ip || "") === String(scope.ip || "");
}

function attachAudienceRealtime(server, service) {
  const chatClients = new Set();
  const wss = new WebSocket.Server({
    server,
    path: "/v2/audience/realtime",
    perMessageDeflate: false,
    maxPayload: 16 * 1024,
  });
  const io = SocketIOServer
    ? new SocketIOServer(server, {
      path: "/v2/audience/socket.io",
      transports: ["polling"],
      allowUpgrades: false,
      serveClient: true,
      cors: {
        origin: true,
        credentials: true,
      },
    })
    : null;

  function forEachClient(handler) {
    for (const client of Array.from(chatClients)) {
      if (client && client.readyState === WebSocket.OPEN) handler(client);
    }
  }

  service.on("broadcast", (message) => {
    forEachClient((client) => sendJson(client, message));
  });

  service.on("target", ({ scope, message }) => {
    forEachClient((client) => {
      if (matchesScope(client.__meta, scope)) sendJson(client, message);
    });
  });

  service.on("close-scope", ({ scope, code = 4003, reason = "closed", delayMs = 0 }) => {
    forEachClient((client) => {
      if (!matchesScope(client.__meta, scope)) return;
      setTimeout(() => {
        try { client.close(code, reason); } catch {}
      }, Math.max(0, Number(delayMs || 0)));
    });
  });

  service.on("close-all", ({ code = 4010, reason = "closed" }) => {
    forEachClient((client) => {
      try { client.close(code, reason); } catch {}
    });
  });

  function sendHello(client, session) {
    sendJson(client, {
      type: "hello",
      time: new Date().toISOString(),
      sessionId: session ? Number(session.id) : 0,
      serverInstanceId: service.serverInstanceId,
      buildVersion: service.health().buildVersion,
      buildLabel: service.health().buildLabel,
      poll: service.getActivePollSnapshot(),
    });
  }

  function rejectClient(client, code, message, closeCode, closeReason) {
    sendJson(client, { type: "error", code, message });
    try {
      client.close(closeCode, closeReason);
    } catch {}
  }

  function handleConnection(client, req) {
    const ip = normalizeIp(req.socket && req.socket.remoteAddress || "unknown");
    const access = service.ensureSessionAccessForRequest(req, ip);
    if (!access.ok) {
      const inactive = access.reason === "session_inactive";
      rejectClient(
        client,
        inactive ? "session_inactive" : "session_join_required",
        inactive
          ? "De sessie is beeindigd. Wacht op een nieuwe join-link."
          : "Deze sessie vereist een nieuwe join-link. Scan de nieuwste QR-code.",
        inactive ? 4009 : 4008,
        inactive ? "session inactive" : "join required"
      );
      return;
    }

    const meta = service.createClientMeta(req, access);
    client.__meta = meta;
    service.persistClient(meta);
    chatClients.add(client);
    sendHello(client, access.session);

    client.on("message", async (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(String(raw || "{}"));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ping") {
        sendJson(client, { type: "pong", t: Date.now() });
        return;
      }

      if (msg.type === "register") {
        const result = service.registerClient(meta, msg);
        if (!result.ok && result.error) sendJson(client, { type: "error", ...result.error });
        return;
      }

      if (msg.type === "client_debug") return;

      if (msg.type === "comment") {
        const result = await service.acceptComment(meta, { name: msg.name, text: msg.text });
        if (result && result.error) sendJson(client, { type: "error", ...result.error });
        return;
      }

      if (msg.type === "reaction") {
        meta.clientTag = msg.clientTag || meta.clientTag;
        const result = await service.acceptReaction(meta, msg.reaction);
        if (result && result.error) sendJson(client, { type: "error", ...result.error });
        return;
      }

      if (msg.type === "poll_vote") {
        meta.clientTag = msg.clientTag || meta.clientTag;
        const result = await service.acceptPollVote(meta, msg.pollId, msg.optionIndex);
        if (result && result.ok) {
          sendJson(client, { type: "poll_vote_ok", pollId: result.pollId, optionIndex: result.optionIndex });
        } else if (result && result.error) {
          sendJson(client, { type: "error", ...result.error });
        }
      }
    });

    client.on("close", () => {
      chatClients.delete(client);
      service.disconnectClient(meta);
    });

    client.on("error", () => {});
  }

  wss.on("connection", handleConnection);

  if (io) {
    io.on("connection", (socket) => {
      const req = buildSocketIoCompatRequest(socket);
      const compatClient = createSocketIoCompatClient(socket);
      handleConnection(compatClient, req);
    });
  }

  return {
    wss,
    io,
    clients: chatClients,
  };
}

module.exports = {
  attachAudienceRealtime,
};
