#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const ARCH_ROOT = path.join(APP_ROOT, "docs", "architecture");
const DIAGRAM_DIR = path.join(ARCH_ROOT, "diagrams");
const GENERATED_DIR = path.join(ARCH_ROOT, "generated");

const ROUTE_SOURCES = [
  { id: "main", label: "For You app server", file: path.join(APP_ROOT, "server.js") },
  { id: "teleprompter", label: "Teleprompter parser", file: path.join(APP_ROOT, "teleprompter-parser", "src", "integration", "express-router.js") },
  { id: "universe", label: "Universe router", file: path.join(REPO_ROOT, "For_universe", "src", "integration", "express-router.js") },
  { id: "camera", label: "Camera Control sidecar", file: path.join(APP_ROOT, "camera-control", "server.js") },
  { id: "sq5", label: "SQ5 sidecar", file: path.join(APP_ROOT, "sq5-control", "server.js") },
  { id: "osc-tester", label: "OSC tester doc sidecar", file: path.join(APP_ROOT, "docs", "project-status", "osc-tester", "server.js") },
];

const RAW_HTTP_ROUTES = [
  {
    source: "Universe router",
    sourceFile: "For_universe/src/integration/express-router.js",
    line: 48,
    method: "GET",
    path: "/api/universe/health",
    area: "universe api",
    access: "public/read-only",
  },
  {
    source: "Universe router",
    sourceFile: "For_universe/src/integration/express-router.js",
    line: 49,
    method: "GET",
    path: "/api/universe/source-schema",
    area: "universe api",
    access: "public/read-only",
  },
  {
    source: "Universe router",
    sourceFile: "For_universe/src/integration/express-router.js",
    line: 50,
    method: "GET",
    path: "/api/universe/graph",
    area: "universe api",
    access: "public/read-only",
  },
  {
    source: "Universe router",
    sourceFile: "For_universe/src/integration/express-router.js",
    line: 51,
    method: "GET",
    path: "/api/universe/runtime",
    area: "universe api",
    access: "public/read-only",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 107,
    method: "WS",
    path: "/ws",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 142,
    method: "GET",
    path: "/api/state",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 147,
    method: "POST",
    path: "/api/tally",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 156,
    method: "POST",
    path: "/api/tally/all",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 166,
    method: "POST",
    path: "/api/camera/:camera/(focus|iris|zoom)",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 176,
    method: "POST",
    path: "/api/camera/:camera/contrast",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 185,
    method: "POST",
    path: "/api/camera/:camera/color/:liftGammaGainOffset",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 195,
    method: "POST",
    path: "/api/camera/:camera/control",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 204,
    method: "POST",
    path: "/api/sync",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "Camera Control sidecar",
    sourceFile: "app/camera-control/server.js",
    line: 210,
    method: "GET",
    path: "/",
    area: "camera sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1434,
    method: "GET",
    path: "/api/status",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1439,
    method: "GET/POST",
    path: "/api/sync",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1445,
    method: "GET",
    path: "/api/streamdeck/state",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1452,
    method: "POST",
    path: "/api/config",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1459,
    method: "POST",
    path: "/api/probe",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1468,
    method: "POST",
    path: "/api/raw",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1475,
    method: "POST",
    path: "/api/scene",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1482,
    method: "POST",
    path: "/api/softkey",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1490,
    method: "POST",
    path: "/api/streamdeck/:target/:action",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1497,
    method: "POST",
    path: "/api/input/:target/:action",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 1504,
    method: "POST",
    path: "/api/output/:target/:action",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "SQ5 sidecar",
    sourceFile: "app/sq5-control/server.js",
    line: 2494,
    method: "GET",
    path: "/",
    area: "sq5 sidecar",
    access: "local or token",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 667,
    method: "GET",
    path: "/",
    area: "diagnostic sidecar",
    access: "local",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 672,
    method: "GET",
    path: "/api/commands",
    area: "diagnostic sidecar",
    access: "local",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 694,
    method: "POST",
    path: "/api/login",
    area: "diagnostic sidecar",
    access: "local",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 700,
    method: "POST",
    path: "/api/set-token",
    area: "diagnostic sidecar",
    access: "local",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 707,
    method: "POST",
    path: "/api/configure-local",
    area: "diagnostic sidecar",
    access: "local",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 712,
    method: "POST",
    path: "/api/restore",
    area: "diagnostic sidecar",
    access: "local",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 717,
    method: "POST",
    path: "/api/send-command",
    area: "diagnostic sidecar",
    access: "local",
  },
  {
    source: "OSC tester doc sidecar",
    sourceFile: "app/docs/project-status/osc-tester/server.js",
    line: 727,
    method: "WS",
    path: "/ws",
    area: "diagnostic sidecar",
    access: "local",
  },
];

const SCHEMA_SOURCES = [
  path.join(APP_ROOT, "server.js"),
  path.join(APP_ROOT, "lib", "dropbox-catalog-sync.js"),
];

const DIAGRAMS = [
  {
    file: "system-context.mmd",
    title: "1. System Context",
    description: "De hoofdkaart: wie praat met welke runtime, database en externe show-systemen.",
  },
  {
    file: "audience-session-flow.mmd",
    title: "2. Audience Session Flow",
    description: "Van QR-token naar chat, moderatie, polls, engagement en algorithm metrics.",
  },
  {
    file: "algorithm-scene-flow.mmd",
    title: "3. Algorithm Scene Flow",
    description: "Hoe catalogusdata scene-keuzes, runs, TouchDesigner, SQ5 en teleprompter voedt.",
  },
  {
    file: "teleprompter-camera-flow.mmd",
    title: "4. Teleprompter And Camera Flow",
    description: "Hoe prepared scenes, ready/reveal, cueing, live captions en camera-pulsen lopen.",
  },
  {
    file: "integration-sidecars.mmd",
    title: "5. Integration Sidecars",
    description: "De losse show-processen rond de app: Stream Deck, TouchDesigner, SQ5, Camera Control, UniFi en Dropbox.",
  },
  {
    file: "database-model.mmd",
    title: "6. Database Model",
    description: "Een vereenvoudigd ER-model van de belangrijkste runtime-tabellen.",
  },
];

const CORE_MODULES = new Set([
  "assert",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "net",
  "node:assert",
  "node:assert/strict",
  "node:crypto",
  "node:fs",
  "node:http",
  "node:net",
  "node:os",
  "node:path",
  "node:url",
  "os",
  "path",
  "stream",
  "url",
]);

const IMPORTANT_EXTERNAL_MODULES = new Set([
  "busboy",
  "cytoscape",
  "express",
  "node:sqlite",
  "osc",
  "socket.io",
  "ws",
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function writeIfChanged(filePath, text) {
  ensureDir(path.dirname(filePath));
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  if (readText(filePath) === normalized) return false;
  fs.writeFileSync(filePath, normalized, "utf8");
  return true;
}

function repoRel(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function appRel(filePath) {
  return path.relative(APP_ROOT, filePath).split(path.sep).join("/");
}

function countLine(text, index) {
  return text.slice(0, index).split("\n").length;
}

function readFirstCallArgument(text, startIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (char === "," && depth === 0) {
      return text.slice(startIndex, index).trim();
    }
  }
  return "";
}

function extractStringLiterals(input) {
  const out = [];
  const regex = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = regex.exec(input))) {
    if (match[1] === "`" && match[2].includes("${")) continue;
    out.push(match[2].replace(/\\\//g, "/"));
  }
  return out;
}

function joinRoute(basePath, routePath) {
  const base = String(basePath || "").replace(/\/+$/, "");
  const route = String(routePath || "").trim();
  if (!route || route === "/") return base || "/";
  return `${base}${route.startsWith("/") ? route : `/${route}`}`;
}

function mountAwareRoute(source, receiver, routePath) {
  if (source.id === "universe" && receiver === "apiRouter") return joinRoute("/api/universe", routePath);
  if (source.id === "universe" && receiver === "uiRouter") return joinRoute("/universe", routePath);
  return routePath || "/";
}

function classifyRoute(routePath, method) {
  const route = String(routePath || "");
  if (route.startsWith("/admin/") || route === "/admin") return "admin";
  if (route.startsWith("/api/teleprompter-parser")) return "teleprompter api";
  if (route.startsWith("/api/universe")) return "universe api";
  if (route.startsWith("/api/")) return "api";
  if (route.startsWith("/teleprompter-parser")) return "teleprompter";
  if (route.startsWith("/universe")) return "universe";
  if (route.startsWith("/stage")) return "stage";
  if (route === "/join" || route === "/chat/history") return "audience session";
  if (method === "USE") return "mount/static";
  return "public";
}

function accessHint(routePath, context) {
  const route = String(routePath || "");
  const snippet = String(context || "");
  if (snippet.includes("requireAdminOrSyncPeer")) return "admin or sync peer";
  if (snippet.includes("requireAdminOrTdPreviewSecret")) return "admin or TD preview secret";
  if (snippet.includes("requireAdmin")) return "admin";
  if (route.startsWith("/admin/") || route === "/admin") return "admin";
  if (route === "/chat/history" || route === "/join") return "session gate";
  if (route.startsWith("/api/teleprompter-parser/cue") || route.startsWith("/api/teleprompter-parser/end-scene")) return "stage control";
  return "public/runtime";
}

function parseRoutesFromSource(source) {
  const text = readText(source.file);
  if (!text) return [];
  const regex = /\b(app|router|apiRouter|uiRouter)\.(get|post|put|patch|delete|use)\s*\(/g;
  const routes = [];
  let match;
  while ((match = regex.exec(text))) {
    const receiver = match[1];
    const method = match[2].toUpperCase();
    const firstArg = readFirstCallArgument(text, regex.lastIndex);
    const paths = extractStringLiterals(firstArg)
      .map((routePath) => mountAwareRoute(source, receiver, routePath))
      .filter((routePath) => routePath.startsWith("/"));
    const line = countLine(text, match.index);
    const context = text.slice(match.index, match.index + 360).replace(/\s+/g, " ").trim();
    for (const routePath of paths) {
      routes.push({
        source: source.label,
        sourceFile: repoRel(source.file),
        line,
        method,
        path: routePath,
        area: classifyRoute(routePath, method),
        access: accessHint(routePath, context),
      });
    }
  }
  return routes;
}

function routeSortKey(route) {
  return `${route.sourceFile}:${String(route.line).padStart(6, "0")}:${route.method}:${route.path}`;
}

function dedupeRoutes(routes) {
  const seen = new Set();
  return routes.filter((route) => {
    const key = `${route.sourceFile}:${route.method}:${route.path}:${route.area}:${route.access}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generatedSourceLink(sourceFile, line) {
  const absolute = path.join(REPO_ROOT, sourceFile);
  const rel = path.relative(GENERATED_DIR, absolute).split(path.sep).join("/");
  return `[${sourceFile}:${line}](${rel}#L${line})`;
}

function generateRoutesMarkdown(routes) {
  const countsByArea = new Map();
  for (const route of routes) {
    countsByArea.set(route.area, (countsByArea.get(route.area) || 0) + 1);
  }
  const areaRows = Array.from(countsByArea.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([area, count]) => `| ${area} | ${count} |`)
    .join("\n");
  const rows = routes
    .slice()
    .sort((a, b) => routeSortKey(a).localeCompare(routeSortKey(b)))
    .map((route) => {
      const source = generatedSourceLink(route.sourceFile, route.line);
      const routePath = String(route.path || "").replace(/\|/g, "\\|");
      return `| ${route.source} | ${source} | ${route.method} | \`${routePath}\` | ${route.area} | ${route.access} |`;
    })
    .join("\n");
  return [
    "# Generated Route Map",
    "",
    "Generated by `npm run docs:architecture` from Express route registrations plus curated raw HTTP sidecar routes. This is a static map; dynamic route guards and WebSocket message types still need human review.",
    "",
    `Total routes found: ${routes.length}`,
    "",
    "## Areas",
    "",
    "| Area | Count |",
    "| --- | ---: |",
    areaRows || "| - | 0 |",
    "",
    "## Routes",
    "",
    "| Runtime | Source | Method | Path | Area | Access hint |",
    "| --- | --- | --- | --- | --- | --- |",
    rows || "| - | - | - | - | - | - |",
    "",
    "## WebSocket Notes",
    "",
    "- Chat clients connect to the main WebSocket server, with Socket.IO polling as compatibility transport.",
    "- `/stage` and QR output subscribe through the stage WebSocket path/query handled by `isStageSubscriptionRequest`.",
    "- `/api-playground` and `/api-playground/stage` use `?operatorStage=1` for operator stage streaming.",
    "- Teleprompter stage and live captions use SSE via `/api/teleprompter-parser/events`.",
  ].join("\n");
}

function parseColumnLines(body) {
  const columns = [];
  const skipPrefixes = ["CONSTRAINT", "FOREIGN", "PRIMARY", "UNIQUE", "CHECK", ")"];
  for (const rawLine of String(body || "").split("\n")) {
    const line = rawLine.trim().replace(/,$/, "");
    if (!line) continue;
    const upper = line.toUpperCase();
    if (skipPrefixes.some((prefix) => upper.startsWith(prefix))) continue;
    const match = line.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+(.+)$/);
    if (!match) continue;
    columns.push({ name: match[1], type: match[2].replace(/\s+/g, " ") });
  }
  return columns;
}

function mergeTable(tableMap, table) {
  if (table.name.endsWith("_next")) return;
  const existing = tableMap.get(table.name) || {
    name: table.name,
    columns: new Map(),
    indexes: [],
    sources: new Set(),
  };
  for (const column of table.columns) existing.columns.set(column.name, column);
  for (const source of table.sources) existing.sources.add(source);
  tableMap.set(table.name, existing);
}

function extractSchema() {
  const tableMap = new Map();
  const indexMap = new Map();
  for (const file of SCHEMA_SOURCES) {
    const text = readText(file);
    const source = repoRel(file);
    const tableRegex = /CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\n\s*\);/g;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(text))) {
      mergeTable(tableMap, {
        name: tableMatch[1],
        columns: parseColumnLines(tableMatch[2]),
        sources: [source],
      });
    }

    const alterRegex = /ALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)\s+([^"`;\n]+)/g;
    let alterMatch;
    while ((alterMatch = alterRegex.exec(text))) {
      const table = tableMap.get(alterMatch[1]);
      if (!table) continue;
      table.columns.set(alterMatch[2], {
        name: alterMatch[2],
        type: alterMatch[3].trim().replace(/\s+/g, " "),
      });
      table.sources.add(source);
    }

    const indexRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\);/g;
    let indexMatch;
    while ((indexMatch = indexRegex.exec(text))) {
      const tableName = indexMatch[2];
      if (tableName.endsWith("_next")) continue;
      const indexes = indexMap.get(tableName) || [];
      indexes.push({
        name: indexMatch[1],
        columns: indexMatch[3].replace(/\s+/g, " ").trim(),
        source,
      });
      indexMap.set(tableName, indexes);
    }
  }
  for (const [tableName, indexes] of indexMap.entries()) {
    const table = tableMap.get(tableName);
    if (table) table.indexes = indexes;
  }
  return Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function tableGroup(name) {
  if (name.startsWith("algorithm_")) return "algorithm";
  if (name.startsWith("session_") || name === "sessions") return "session";
  if (name.startsWith("poll")) return "polls";
  if (name.startsWith("sync_")) return "local sync";
  if (name.startsWith("catalog_")) return "catalog mirror";
  if (name.startsWith("admin_")) return "admin";
  if (name === "chat_messages" || name === "moderation_actions") return "chat/moderation";
  if (name === "settings") return "settings";
  return "other";
}

function generateSchemaMarkdown(tables) {
  const grouped = new Map();
  for (const table of tables) {
    const group = tableGroup(table.name);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(table);
  }

  const summaryRows = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, groupTables]) => `| ${group} | ${groupTables.length} | ${groupTables.map((table) => `\`${table.name}\``).join(", ")} |`)
    .join("\n");

  const sections = tables.map((table) => {
    const columnRows = Array.from(table.columns.values())
      .map((column) => `| \`${column.name}\` | ${column.type.replace(/\|/g, "\\|")} |`)
      .join("\n");
    const indexes = table.indexes.length
      ? table.indexes.map((index) => `- \`${index.name}\` on \`${index.columns}\``).join("\n")
      : "- Geen expliciete index gevonden in de extractie.";
    return [
      `### ${table.name}`,
      "",
      `Bron: ${Array.from(table.sources).map((source) => `\`${source}\``).join(", ")}`,
      "",
      "| Column | Type / constraints |",
      "| --- | --- |",
      columnRows || "| - | - |",
      "",
      "Indexes:",
      "",
      indexes,
    ].join("\n");
  }).join("\n\n");

  return [
    "# Generated SQLite Schema Map",
    "",
    "Generated by `npm run docs:architecture` from `CREATE TABLE`, `ALTER TABLE ADD COLUMN` and `CREATE INDEX` statements. JSON links such as `character_ids_json` are conceptual relations, not enforced foreign keys.",
    "",
    `Total tables found: ${tables.length}`,
    "",
    "## Table Groups",
    "",
    "| Group | Count | Tables |",
    "| --- | ---: | --- |",
    summaryRows || "| - | 0 | - |",
    "",
    "## Tables",
    "",
    sections,
  ].join("\n");
}

function walkJs(dirPath, out = []) {
  if (!fs.existsSync(dirPath)) return out;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "vendor") continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkJs(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) out.push(fullPath);
  }
  return out;
}

function collectRuntimeJsFiles() {
  const files = new Set([
    path.join(APP_ROOT, "server.js"),
    path.join(APP_ROOT, "camera-control", "server.js"),
    path.join(APP_ROOT, "sq5-control", "server.js"),
    path.join(REPO_ROOT, "crowd-system", "index.js"),
    path.join(REPO_ROOT, "crowd-system", "lib", "crowd-engine.js"),
  ]);
  [
    path.join(APP_ROOT, "lib"),
    path.join(APP_ROOT, "teleprompter-parser", "src"),
    path.join(REPO_ROOT, "For_universe", "src", "domain"),
    path.join(REPO_ROOT, "For_universe", "src", "data"),
    path.join(REPO_ROOT, "For_universe", "src", "integration"),
  ].forEach((dirPath) => {
    for (const file of walkJs(dirPath)) files.add(file);
  });
  return Array.from(files).filter((file) => fs.existsSync(file)).sort((a, b) => repoRel(a).localeCompare(repoRel(b)));
}

function resolveRelativeRequire(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.js`,
    path.join(base, "index.js"),
    path.join(base, "server.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || base;
}

function collectModuleEdges(files) {
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const edges = [];
  const externalNodes = new Set();
  for (const file of files) {
    const text = readText(file);
    const regex = /require\(\s*["']([^"']+)["']\s*\)/g;
    let match;
    while ((match = regex.exec(text))) {
      const spec = match[1];
      if (spec.startsWith(".")) {
        const resolved = path.resolve(resolveRelativeRequire(file, spec));
        if (fileSet.has(resolved)) {
          edges.push([repoRel(file), repoRel(resolved)]);
        }
        continue;
      }
      if (IMPORTANT_EXTERNAL_MODULES.has(spec)) {
        const external = `external:${spec}`;
        externalNodes.add(external);
        edges.push([repoRel(file), external]);
      } else if (!CORE_MODULES.has(spec) && !spec.startsWith("node:")) {
        const external = `external:${spec}`;
        externalNodes.add(external);
        edges.push([repoRel(file), external]);
      }
    }
  }
  const seen = new Set();
  return edges.filter(([from, to]) => {
    const key = `${from}->${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mermaidNodeIdFactory() {
  const ids = new Map();
  return (key) => {
    if (ids.has(key)) return ids.get(key);
    const base = String(key).replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 50) || "node";
    let id = `n_${base}`;
    let counter = 1;
    while (Array.from(ids.values()).includes(id)) {
      counter += 1;
      id = `n_${base}_${counter}`;
    }
    ids.set(key, id);
    return id;
  };
}

function shortModuleLabel(key) {
  if (key.startsWith("external:")) return key.replace("external:", "npm/core: ");
  if (key.startsWith("app/")) return key.replace("app/", "");
  return key;
}

function escapeMermaidLabel(value) {
  return String(value).replace(/"/g, "'").replace(/\n/g, " ");
}

function generateDependencyMermaid(edges) {
  const nodeId = mermaidNodeIdFactory();
  const nodes = new Set();
  for (const [from, to] of edges) {
    nodes.add(from);
    nodes.add(to);
  }
  const nodeLines = Array.from(nodes)
    .sort()
    .map((node) => `  ${nodeId(node)}["${escapeMermaidLabel(shortModuleLabel(node))}"]`);
  const edgeLines = edges
    .slice()
    .sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`))
    .map(([from, to]) => `  ${nodeId(from)} --> ${nodeId(to)}`);
  return [
    "flowchart LR",
    "  %% Generated from runtime CommonJS require(...) calls.",
    ...nodeLines,
    ...edgeLines,
  ].join("\n");
}

function generateOverview(routes, tables) {
  const diagramSections = DIAGRAMS.map((diagram) => {
    const text = readText(path.join(DIAGRAM_DIR, diagram.file)).trim();
    return [
      `## ${diagram.title}`,
      "",
      diagram.description,
      "",
      "```mermaid",
      text,
      "```",
    ].join("\n");
  }).join("\n\n");

  return [
    "# For You Architectuur En Dataflow",
    "",
    "Dit bestand is gegenereerd door `npm run docs:architecture`. Pas de bron-diagrammen aan in `docs/architecture/diagrams/` en draai daarna de generator opnieuw.",
    "",
    "## Snel Lezen",
    "",
    "- De app heeft een centrale Node/Express runtime in `app/server.js` met SQLite als canonieke runtime-database.",
    "- Publiek gaat via QR/join naar de live chat; admin, stage, algoritme, paden, universe en teleprompter zijn aparte views op dezelfde runtime.",
    "- `show-algorithm` bepaalt de volgorde/aanbeveling uit catalogusdata, paden en live feedback.",
    "- TouchDesigner, SQ5, Camera Control, Stream Deck, UniFi, Dropbox en AI-providers hangen als integraties rondom de centrale app.",
    "- For_universe is geen tweede runtime-database; het leest dezelfde `app/data/live.sqlite` read-only.",
    "",
    "## Gegenereerde Kaarten",
    "",
    `- [Routes](generated/routes.md): ${routes.length} route entries gevonden.`,
    `- [SQLite schema](generated/sqlite-schema.md): ${tables.length} tabellen gevonden.`,
    "- [Code dependencies](generated/code-deps.mmd): runtime `require(...)` relaties.",
    "",
    diagramSections,
  ].join("\n");
}

function main() {
  ensureDir(GENERATED_DIR);

  const routes = dedupeRoutes(ROUTE_SOURCES.flatMap(parseRoutesFromSource).concat(RAW_HTTP_ROUTES));
  const tables = extractSchema();
  const files = collectRuntimeJsFiles();
  const edges = collectModuleEdges(files);

  const changed = [];
  if (writeIfChanged(path.join(GENERATED_DIR, "routes.md"), generateRoutesMarkdown(routes))) changed.push("generated/routes.md");
  if (writeIfChanged(path.join(GENERATED_DIR, "sqlite-schema.md"), generateSchemaMarkdown(tables))) changed.push("generated/sqlite-schema.md");
  if (writeIfChanged(path.join(GENERATED_DIR, "code-deps.mmd"), generateDependencyMermaid(edges))) changed.push("generated/code-deps.mmd");
  if (writeIfChanged(path.join(ARCH_ROOT, "00-overzicht.md"), generateOverview(routes, tables))) changed.push("00-overzicht.md");

  console.log(`Architecture maps ready: ${routes.length} routes, ${tables.length} tables, ${edges.length} dependency edges.`);
  if (changed.length) {
    console.log(`Updated: ${changed.join(", ")}`);
  } else {
    console.log("No files changed.");
  }
}

main();
