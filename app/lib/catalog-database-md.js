"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { defaultRootDir } = require("./dropbox-catalog-sync");

const SOURCE_PREFIXES = Object.freeze([
  "00 Index voor GPT/",
  "01 Research/",
  "02 Personages/",
  "03 Omgevingen/",
  "04 Situaties/",
  "06 Stijlregels/",
  "07 Grappige voorbeeldscènes/",
  "08 Runs & Scores/",
  "09 Chatlogs/transcripts/",
]);

const SUPPORTED_EXTENSIONS = Object.freeze(new Set([
  ".md",
  ".txt",
  ".json",
  ".jsonl",
  ".csv",
]));

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function atomicWriteFile(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, text, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeFileIfChanged(filePath, text) {
  if (hashText(readText(filePath)) === hashText(text)) return false;
  atomicWriteFile(filePath, text);
  return true;
}

function relativePosix(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function hasHiddenSegment(relPath) {
  return String(relPath || "").split("/").some((part) => part.startsWith("."));
}

function isSupportedSourceFile(relPath) {
  const normalized = String(relPath || "").split(path.sep).join("/");
  if (!normalized || normalized.includes("\0")) return false;
  if (hasHiddenSegment(normalized)) return false;
  if (normalized.startsWith("09 Chatlogs/raw/")) return false;
  if (normalized.startsWith("10 Techniek & Sync/")) return false;
  const base = path.basename(normalized);
  if (!base || base === ".DS_Store") return false;
  if (/\.sqlite(?:-(?:shm|wal))?$/i.test(base)) return false;
  if (/^\.?env(?:\.|$)/i.test(base)) return false;
  if (!SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  return SUPPORTED_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function walkFiles(dirPath, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry || !entry.name || entry.name.startsWith(".")) continue;
    const filePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) walkFiles(filePath, out);
    else if (entry.isFile()) out.push(filePath);
  }
  return out;
}

function createCatalogDatabaseMarkdown(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.env.FORYOU_DROPBOX_CATALOG_DIR || defaultRootDir());
  if (!fs.existsSync(rootDir)) {
    return {
      ok: false,
      rootDir,
      files: [],
      markdown: `# For You database\n\nGenerated: ${nowIso()}\nSource: ${rootDir}\nFiles: 0\n\nDropbox catalogusmap niet gevonden.\n`,
    };
  }
  const files = walkFiles(rootDir)
    .map((absPath) => ({ absPath, relPath: relativePosix(rootDir, absPath) }))
    .filter((file) => isSupportedSourceFile(file.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath, "nl-NL"));
  const parts = [
    "# For You database",
    "",
    `Generated: ${nowIso()}`,
    `Source: ${rootDir}`,
    `Files: ${files.length}`,
    "",
    "---",
    "",
  ];
  for (const file of files) {
    parts.push(`## ${file.relPath}`, "", readText(file.absPath).trimEnd(), "", "---", "");
  }
  return {
    ok: true,
    rootDir,
    files,
    markdown: parts.join("\n"),
  };
}

function writeCatalogDatabaseMarkdown(options = {}) {
  const outputPaths = (Array.isArray(options.outputPaths) ? options.outputPaths : [options.outputPath])
    .filter(Boolean)
    .map((item) => path.resolve(String(item)));
  const uniqueOutputPaths = Array.from(new Set(outputPaths));
  const built = createCatalogDatabaseMarkdown(options);
  const outputs = uniqueOutputPaths.map((filePath) => ({
    filePath,
    changed: writeFileIfChanged(filePath, built.markdown),
  }));
  return {
    ok: built.ok,
    rootDir: built.rootDir,
    fileCount: built.files.length,
    bytes: Buffer.byteLength(built.markdown, "utf8"),
    outputs,
  };
}

module.exports = {
  createCatalogDatabaseMarkdown,
  isSupportedSourceFile,
  writeCatalogDatabaseMarkdown,
};
