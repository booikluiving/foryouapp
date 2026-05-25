"use strict";

const PATHS_EDITOR_STATE_SCHEMA_VERSION = "paths.editor-state.v0";
const PATHS_STORE_SCHEMA_VERSION = "paths.store.v0";

class PathsInputError extends Error {
  constructor(message, issues = [], statusCode = 400) {
    super(message);
    this.name = "PathsInputError";
    this.issues = issues;
    this.statusCode = statusCode;
  }
}

module.exports = {
  PATHS_EDITOR_STATE_SCHEMA_VERSION,
  PATHS_STORE_SCHEMA_VERSION,
  PathsInputError,
};
