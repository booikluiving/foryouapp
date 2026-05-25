"use strict";

async function sendAction(action, options = {}) {
  if (options.nonBlocking || action.ackMode === "fire-and-forget") {
    return {
      stage: "sent",
      state: "pending",
      message: "sent without waiting for acknowledgement",
      warning: false,
    };
  }
  if (action.simulate === "timeout") {
    return {
      stage: "timedOut",
      state: "warning",
      message: "target acknowledgement timed out",
      warning: true,
    };
  }
  if (action.ackMode === "required-ready") {
    return {
      stage: "loaded",
      state: "ok",
      message: "target reports required payload loaded",
      warning: false,
    };
  }
  return {
    stage: "applied",
    state: "ok",
    message: "target acknowledged cue",
    warning: false,
  };
}

module.exports = {
  sendAction,
};
