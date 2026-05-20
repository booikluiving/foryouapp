"use strict";

const { DEFAULT_TITLE, PARSER_ID, parseTelepromptText } = require("../domain/parse-teleprompt");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyTeleprompt() {
  return {
    version: 0,
    title: DEFAULT_TITLE,
    characters: [],
    lines: [],
    source: {
      kind: "empty",
      parser: PARSER_ID,
      generatedAt: "",
    },
    updatedAt: "",
  };
}

function createTelepromptStore(options = {}) {
  const parser = typeof options.parser === "function" ? options.parser : parseTelepromptText;
  let version = 0;
  let currentTeleprompt = createEmptyTeleprompt();

  function current() {
    return cloneJson(currentTeleprompt);
  }

  function ingest(input = {}) {
    const parsed = parser(input);
    version += 1;
    currentTeleprompt = {
      ...parsed,
      version,
      updatedAt: parsed.source && parsed.source.generatedAt ? parsed.source.generatedAt : new Date().toISOString(),
    };
    return current();
  }

  return {
    current,
    ingest,
  };
}

module.exports = {
  createEmptyTeleprompt,
  createTelepromptStore,
};

