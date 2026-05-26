"use strict";

const { URL } = require("node:url");

const WebSocket = require("ws");

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ type: "operator_stage_error", error: "json_encode_failed" });
  }
}

function parseMessage(raw) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return { type: "operator_stage_invalid_json" };
  }
}

function send(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(safeJson(payload));
}

function broadcast(wss, payload) {
  for (const client of wss.clients) send(client, payload);
}

function attachOperatorStageRealtime(server, operatorService, options = {}) {
  if (!server || !operatorService) throw new Error("script_agent_operator_realtime_missing_dependencies");
  const pathname = options.pathname || "/v0/script-agent/operator/stage/ws";
  const wss = new WebSocket.Server({ noServer: true });

  function onUpgrade(req, socket, head) {
    let requestedPath = "";
    try {
      requestedPath = new URL(req.url, "http://127.0.0.1").pathname;
    } catch {
      requestedPath = "";
    }
    if (requestedPath !== pathname) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  async function handleClientMessage(ws, message) {
    const payload = parseMessage(message);
    if (payload.type === "ping") {
      send(ws, { type: "pong", at: new Date().toISOString() });
      return;
    }
    if (payload.type === "operator_stage_refresh") {
      try {
        const snapshot = operatorService.snapshotStage();
        if (!snapshot.draft) await operatorService.currentDraft({ refreshRuntime: true });
        send(ws, { type: "operator_stage_state", reason: "manual_refresh", stage: operatorService.snapshotStage() });
      } catch (err) {
        send(ws, {
          type: "operator_stage_error",
          error: err && err.message ? String(err.message) : "operator_stage_refresh_failed",
        });
      }
      return;
    }
    if (payload.type === "operator_stage_draft") {
      operatorService.updateStageDraft(payload.text || "", {
        sourceId: payload.sourceId,
        revision: payload.revision,
      });
      return;
    }
    if (payload.type === "operator_stage_clear_draft") {
      operatorService.updateStageDraft("", {
        sourceId: payload.sourceId,
        revision: payload.revision,
      });
      return;
    }
    if (payload.type === "operator_stage_control") {
      operatorService.updateStageControl(payload);
      return;
    }
    if (payload.type === "operator_stage_style") {
      operatorService.updateStageStyle(payload.style || payload, {
        sourceId: payload.sourceId,
      });
      return;
    }
    if (payload.type === "operator_stage_submit") {
      try {
        await operatorService.streamChat({
          sessionId: payload.sessionId,
          message: payload.text,
          sourceId: payload.sourceId,
        }, (event) => send(ws, { type: "operator_stage_chat_event", event }));
      } catch (err) {
        send(ws, {
          type: "operator_stage_error",
          error: err && err.message ? String(err.message) : "operator_stage_submit_failed",
        });
      }
      return;
    }
    send(ws, { type: "operator_stage_error", error: "operator_stage_unknown_message" });
  }

  const onStage = (payload) => broadcast(wss, payload);
  operatorService.emitter.on("stage", onStage);

  wss.on("connection", (ws) => {
    send(ws, {
      type: "operator_stage_hello",
      stage: operatorService.snapshotStage(),
      at: new Date().toISOString(),
    });
    ws.on("message", (message) => {
      Promise.resolve(handleClientMessage(ws, message)).catch((err) => {
        send(ws, {
          type: "operator_stage_error",
          error: err && err.message ? String(err.message) : "operator_stage_message_failed",
        });
      });
    });
  });

  server.on("upgrade", onUpgrade);
  server.on("close", () => {
    server.off("upgrade", onUpgrade);
    operatorService.emitter.off("stage", onStage);
    wss.close();
  });

  return wss;
}

module.exports = {
  attachOperatorStageRealtime,
};
