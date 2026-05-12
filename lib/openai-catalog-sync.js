"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { defaultRootDir } = require("./dropbox-catalog-sync");

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const MANAGED_FILENAME_PREFIX = "foryou-catalog--";
const MANAGED_APP = "catalog";
const MANAGED_SOURCE = "dropbox_catalog";
const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_INTERVAL_MS = 1500;

const SOURCE_PREFIXES = Object.freeze([
  "00 Index voor GPT/",
  "01 Research/",
  "02 Personages/",
  "03 Omgevingen/",
  "04 Situaties/",
  "06 Stijlregels/",
  "07 Grappige voorbeeldscènes/",
  "08 Runs & Scores/",
]);

const SOURCE_EXACT_DIRS = Object.freeze([
  "00 Index voor GPT",
  "01 Research",
  "02 Personages",
  "03 Omgevingen",
  "04 Situaties",
  "06 Stijlregels",
  "07 Grappige voorbeeldscènes",
  "08 Runs & Scores",
]);

const SUPPORTED_SOURCE_EXTENSIONS = Object.freeze(new Set([
  ".md",
  ".txt",
  ".json",
  ".jsonl",
  ".csv",
]));

function nowIso() {
  return new Date().toISOString();
}

function isTruthyEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "ja", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeText(value, max = 2000) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeVectorStoreId(value, fallback = "") {
  const raw = normalizeText(value, 120);
  if (!raw) return fallback;
  if (!/^vs_[A-Za-z0-9_-]+$/.test(raw)) return fallback;
  return raw;
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashText(value) {
  return hashBuffer(Buffer.from(String(value || ""), "utf8"));
}

function relativePosix(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function hasHiddenSegment(relPath) {
  return String(relPath || "").split("/").some((part) => part.startsWith("."));
}

function isSourceRelPath(relPath) {
  const normalized = String(relPath || "").split(path.sep).join("/");
  if (!normalized || normalized.includes("\0")) return false;
  if (hasHiddenSegment(normalized)) return false;
  if (normalized.startsWith("09 Chatlogs/raw/")) return false;
  if (normalized.startsWith("10 Techniek & Sync/")) return false;
  if (normalized.startsWith("09 Chatlogs/transcripts/")) return isSupportedSourceFile(normalized);
  if (SOURCE_EXACT_DIRS.includes(normalized)) return false;
  if (!SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  return isSupportedSourceFile(normalized);
}

function isSupportedSourceFile(relPath) {
  const ext = path.extname(String(relPath || "").toLowerCase());
  if (!SUPPORTED_SOURCE_EXTENSIONS.has(ext)) return false;
  const base = path.basename(String(relPath || ""));
  if (!base || base === ".DS_Store") return false;
  if (/\.sqlite(?:-(?:shm|wal))?$/i.test(base)) return false;
  if (/^\.?env(?:\.|$)/i.test(base)) return false;
  return true;
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
    if (entry.isDirectory()) {
      walkFiles(filePath, out);
    } else if (entry.isFile()) {
      out.push(filePath);
    }
  }
  return out;
}

function slugifyFilename(value, fallback = "catalog") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || fallback;
}

function base64Url(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64url");
}

function decodeBase64Url(value) {
  try {
    return Buffer.from(String(value || ""), "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function uploadExtensionForRelPath(relPath) {
  const ext = path.extname(String(relPath || "").toLowerCase());
  if (ext === ".md" || ext === ".txt" || ext === ".json" || ext === ".csv") return ext;
  return ".txt";
}

function contentTypeForRelPath(relPath) {
  const ext = path.extname(String(relPath || "").toLowerCase());
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".jsonl") return "text/plain; charset=utf-8";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function uploadFilenameForRelPath(relPath) {
  const normalized = String(relPath || "").split(path.sep).join("/");
  const slug = slugifyFilename(normalized.replace(/\.[^.]+$/, ""));
  const encoded = base64Url(normalized);
  return `${MANAGED_FILENAME_PREFIX}${slug}--${encoded}${uploadExtensionForRelPath(normalized)}`;
}

function relPathFromManagedFilename(filename) {
  const base = path.basename(String(filename || ""));
  if (!base.startsWith(MANAGED_FILENAME_PREFIX)) return "";
  const rest = base.slice(MANAGED_FILENAME_PREFIX.length);
  const match = rest.match(/--([A-Za-z0-9_-]+)\.[^.]+$/);
  if (match) return decodeBase64Url(match[1]);
  const legacy = rest.match(/^([A-Za-z0-9_-]+)\.[^.]+$/);
  return legacy ? decodeBase64Url(legacy[1]) : "";
}

function safeErrorMessage(err, fallback = "openai_catalog_failed") {
  return normalizeText(err && err.message ? err.message : fallback, 300)
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-...");
}

class PublicOpenAiCatalogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonOrError(text, fallback = {}) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function createHttpOpenAiClient(options = {}) {
  const apiKey = String(options.apiKey || process.env.OPENAI_API_KEY || "").trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = String(options.baseUrl || OPENAI_API_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));

  async function request(method, apiPath, options = {}) {
    if (!apiKey) throw new PublicOpenAiCatalogError("openai_api_key_missing", 400);
    if (typeof fetchImpl !== "function") throw new PublicOpenAiCatalogError("fetch_unavailable", 500);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = new URL(`${baseUrl}${apiPath}`);
    const params = options.query && typeof options.query === "object" ? options.query : {};
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    };
    let body = undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const parsed = parseJsonOrError(text, null);
        const message = parsed && parsed.error && parsed.error.message
          ? parsed.error.message
          : text || `openai_http_${response.status}`;
        const err = new PublicOpenAiCatalogError(safeErrorMessage({ message }, `openai_http_${response.status}`), response.status || 502);
        err.body = parsed;
        throw err;
      }
      if (options.parse === "text") return text;
      return parseJsonOrError(text, {});
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async listVectorStores(params = {}) {
      return request("GET", "/vector_stores", { query: params });
    },
    async retrieveVectorStore(vectorStoreId) {
      return request("GET", `/vector_stores/${encodeURIComponent(vectorStoreId)}`);
    },
    async listVectorStoreFiles(vectorStoreId, params = {}) {
      return request("GET", `/vector_stores/${encodeURIComponent(vectorStoreId)}/files`, { query: params });
    },
    async retrieveVectorStoreFile(vectorStoreId, fileId) {
      return request("GET", `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`);
    },
    async updateVectorStoreFileAttributes(vectorStoreId, fileId, attributes) {
      return request("POST", `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`, {
        body: { attributes },
      });
    },
    async deleteVectorStoreFile(vectorStoreId, fileId) {
      return request("DELETE", `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`);
    },
    async retrieveFile(fileId) {
      return request("GET", `/files/${encodeURIComponent(fileId)}`);
    },
    async retrieveFileContent(fileId) {
      return request("GET", `/files/${encodeURIComponent(fileId)}/content`, { parse: "text" });
    },
    async deleteFile(fileId) {
      return request("DELETE", `/files/${encodeURIComponent(fileId)}`);
    },
    async uploadFile(localFile) {
      if (typeof FormData !== "function" || typeof Blob !== "function") {
        throw new PublicOpenAiCatalogError("formdata_unavailable", 500);
      }
      const form = new FormData();
      const buffer = fs.readFileSync(localFile.absPath);
      const blob = new Blob([buffer], { type: localFile.contentType || "text/plain; charset=utf-8" });
      form.append("file", blob, localFile.uploadFilename || path.basename(localFile.relPath));
      form.append("purpose", "assistants");
      return request("POST", "/files", { form });
    },
    async attachFile(vectorStoreId, fileId, attributes) {
      return request("POST", `/vector_stores/${encodeURIComponent(vectorStoreId)}/files`, {
        body: { file_id: fileId, attributes },
      });
    },
    async createResponse(payload) {
      return request("POST", "/responses", { body: payload });
    },
  };
}

function createLocalManifest(rootDir) {
  const resolvedRoot = path.resolve(rootDir || defaultRootDir());
  if (!fs.existsSync(resolvedRoot)) {
    return { rootDir: resolvedRoot, exists: false, files: [] };
  }
  const files = walkFiles(resolvedRoot)
    .map((absPath) => {
      const relPath = relativePosix(resolvedRoot, absPath);
      if (!isSourceRelPath(relPath)) return null;
      const buffer = fs.readFileSync(absPath);
      const stat = fs.statSync(absPath);
      return {
        relPath,
        absPath,
        bytes: buffer.length,
        sha256: hashBuffer(buffer),
        mtimeMs: Math.round(Number(stat.mtimeMs || 0)),
        uploadFilename: uploadFilenameForRelPath(relPath),
        contentType: contentTypeForRelPath(relPath),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.relPath.localeCompare(b.relPath, "nl-NL"));
  return { rootDir: resolvedRoot, exists: true, files };
}

function normalizeRemoteAttributes(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

async function listAllVectorStoreFiles(client, vectorStoreId) {
  const out = [];
  let after = "";
  for (let i = 0; i < 1000; i += 1) {
    const page = await client.listVectorStoreFiles(vectorStoreId, {
      limit: 100,
      after,
    });
    const rows = Array.isArray(page && page.data) ? page.data : [];
    out.push(...rows);
    if (!page || !page.has_more || !rows.length) break;
    const last = rows[rows.length - 1];
    after = String((last && (last.id || last.file_id)) || page.last_id || "");
    if (!after) break;
  }
  return out;
}

async function createRemoteManifest(client, vectorStoreId, options = {}) {
  const vectorStore = await client.retrieveVectorStore(vectorStoreId);
  const rows = await listAllVectorStoreFiles(client, vectorStoreId);
  const files = [];
  const fetchContentHash = !!options.fetchContentHash;
  const localByRelPath = options.localByRelPath instanceof Map ? options.localByRelPath : new Map();

  for (const row of rows) {
    const fileId = String((row && (row.id || row.file_id)) || "").trim();
    if (!fileId) continue;
    const attributes = normalizeRemoteAttributes(row.attributes);
    let fileMeta = {};
    try {
      fileMeta = await client.retrieveFile(fileId);
    } catch {}
    const filename = String(row.filename || fileMeta.filename || "").trim();
    const relPath = normalizeText(attributes.rel_path || relPathFromManagedFilename(filename), 800);
    const managed = attributes.foryou_app === MANAGED_APP || filename.startsWith(MANAGED_FILENAME_PREFIX);
    let sha256 = normalizeText(attributes.sha256, 80);
    if (fetchContentHash && managed && relPath && localByRelPath.has(relPath) && (!sha256 || sha256 !== localByRelPath.get(relPath).sha256)) {
      try {
        sha256 = hashText(await client.retrieveFileContent(fileId));
      } catch {}
    }
    files.push({
      id: fileId,
      fileId,
      vectorStoreFileId: String(row.vector_store_file_id || row.id || fileId),
      filename,
      relPath,
      managed,
      sha256,
      status: String(row.status || ""),
      createdAt: Number(row.created_at || fileMeta.created_at || 0) || 0,
      bytes: Number(row.usage_bytes || fileMeta.bytes || 0) || 0,
      attributes,
      lastError: row.last_error || null,
    });
  }

  return {
    vectorStore: {
      id: String(vectorStore && vectorStore.id || vectorStoreId),
      name: String(vectorStore && vectorStore.name || ""),
      status: String(vectorStore && vectorStore.status || ""),
      fileCounts: vectorStore && vectorStore.file_counts ? vectorStore.file_counts : {},
      usageBytes: Number(vectorStore && (vectorStore.usage_bytes || vectorStore.bytes) || 0) || 0,
    },
    files,
  };
}

function desiredAttributes(localFile, syncedAt = nowIso()) {
  return {
    foryou_app: MANAGED_APP,
    rel_path: String(localFile.relPath || "").slice(0, 512),
    sha256: String(localFile.sha256 || ""),
    source: MANAGED_SOURCE,
    synced_at: syncedAt,
    bytes: Number(localFile.bytes || 0),
    mtime_ms: Number(localFile.mtimeMs || 0),
  };
}

function needsAdopt(remote, localFile) {
  const attrs = remote && remote.attributes ? remote.attributes : {};
  return attrs.foryou_app !== MANAGED_APP
    || attrs.source !== MANAGED_SOURCE
    || attrs.rel_path !== localFile.relPath
    || attrs.sha256 !== localFile.sha256;
}

function groupRemotesByRelPath(remoteFiles) {
  const grouped = new Map();
  const unassigned = [];
  for (const remote of remoteFiles || []) {
    if (!remote || !remote.managed) continue;
    if (!remote.relPath) {
      unassigned.push(remote);
      continue;
    }
    const bucket = grouped.get(remote.relPath) || [];
    bucket.push(remote);
    grouped.set(remote.relPath, bucket);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }
  return { grouped, unassigned };
}

function createPlanFromManifests(localManifest, remoteManifest) {
  const localFiles = Array.isArray(localManifest.files) ? localManifest.files : [];
  const localByRelPath = new Map(localFiles.map((file) => [file.relPath, file]));
  const { grouped, unassigned } = groupRemotesByRelPath(remoteManifest.files || []);
  const actions = [];

  for (const localFile of localFiles) {
    const remotes = grouped.get(localFile.relPath) || [];
    if (!remotes.length) {
      actions.push({ type: "upload", relPath: localFile.relPath, local: localFile, remotes: [] });
      continue;
    }
    const exact = remotes.find((remote) => remote.sha256 && remote.sha256 === localFile.sha256) || null;
    const primary = exact || remotes[0];
    const extras = remotes.filter((remote) => remote !== primary);
    if (exact) {
      if (needsAdopt(exact, localFile)) {
        actions.push({ type: "adopt", relPath: localFile.relPath, local: localFile, remotes: [exact], reason: "attributes_outdated" });
      } else {
        actions.push({ type: "skip", relPath: localFile.relPath, local: localFile, remotes: [exact] });
      }
      for (const extra of extras) {
        actions.push({ type: "delete", relPath: localFile.relPath, remotes: [extra], reason: "duplicate_managed_file" });
      }
      continue;
    }
    actions.push({ type: "replace", relPath: localFile.relPath, local: localFile, remotes, reason: "content_changed_or_unknown" });
  }

  for (const [relPath, remotes] of grouped.entries()) {
    if (localByRelPath.has(relPath)) continue;
    for (const remote of remotes) {
      actions.push({ type: "delete", relPath, remotes: [remote], reason: "missing_locally" });
    }
  }

  for (const remote of unassigned) {
    actions.push({ type: "delete", relPath: "", remotes: [remote], reason: "managed_without_rel_path" });
  }

  const summary = actions.reduce((acc, action) => {
    acc[action.type] = (acc[action.type] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { total: 0, upload: 0, replace: 0, delete: 0, adopt: 0, skip: 0 });

  const ignoredRemote = (remoteManifest.files || []).filter((file) => file && !file.managed).length;
  return {
    ok: true,
    createdAt: nowIso(),
    rootDir: localManifest.rootDir,
    localExists: !!localManifest.exists,
    vectorStore: remoteManifest.vectorStore,
    localFileCount: localFiles.length,
    remoteFileCount: Array.isArray(remoteManifest.files) ? remoteManifest.files.length : 0,
    ignoredRemoteFileCount: ignoredRemote,
    summary,
    actions,
  };
}

function publicLocalFile(file) {
  if (!file) return null;
  return {
    relPath: file.relPath,
    bytes: file.bytes,
    sha256: file.sha256,
    mtimeMs: file.mtimeMs,
    uploadFilename: file.uploadFilename,
  };
}

function publicRemoteFile(file) {
  if (!file) return null;
  return {
    fileId: file.fileId || file.id,
    filename: file.filename,
    relPath: file.relPath,
    managed: !!file.managed,
    sha256: file.sha256,
    status: file.status,
    createdAt: file.createdAt,
    bytes: file.bytes,
    lastError: file.lastError || null,
  };
}

function publicPlan(plan) {
  return {
    ok: !!(plan && plan.ok),
    createdAt: plan.createdAt,
    rootDir: plan.rootDir,
    localExists: !!plan.localExists,
    vectorStore: plan.vectorStore || null,
    localFileCount: Number(plan.localFileCount || 0),
    remoteFileCount: Number(plan.remoteFileCount || 0),
    ignoredRemoteFileCount: Number(plan.ignoredRemoteFileCount || 0),
    summary: plan.summary || {},
    actions: (plan.actions || []).map((action) => ({
      type: action.type,
      relPath: action.relPath || "",
      reason: action.reason || "",
      local: publicLocalFile(action.local),
      remotes: (action.remotes || []).map(publicRemoteFile),
    })),
  };
}

function extractResponseText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const pieces = [];
  for (const item of response.output || []) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && typeof part.text === "string") pieces.push(part.text);
    }
  }
  return pieces.join("\n").trim();
}

function extractCitations(response) {
  const citations = [];
  for (const item of response.output || []) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      const annotations = Array.isArray(part && part.annotations) ? part.annotations : [];
      for (const annotation of annotations) {
        if (!annotation || annotation.type !== "file_citation") continue;
        citations.push({
          fileId: String(annotation.file_id || ""),
          filename: String(annotation.filename || ""),
          index: Number(annotation.index || 0) || 0,
        });
      }
    }
  }
  return citations;
}

function extractSearchResults(response) {
  const results = [];
  for (const item of response.output || []) {
    if (!item || item.type !== "file_search_call") continue;
    const rows = Array.isArray(item.search_results) ? item.search_results : [];
    for (const result of rows) {
      results.push({
        fileId: String(result.file_id || ""),
        filename: String(result.filename || ""),
        score: Number(result.score || 0) || 0,
        text: normalizeText(result.text || result.content || "", 1000),
      });
    }
  }
  return results;
}

async function deleteManagedRemote(client, vectorStoreId, remote) {
  const fileId = String(remote && (remote.fileId || remote.id) || "").trim();
  if (!fileId) return { fileId: "", deleted: false };
  const result = { fileId, deleted: false, detached: false, fileDeleted: false };
  try {
    await client.deleteVectorStoreFile(vectorStoreId, fileId);
    result.detached = true;
  } catch (err) {
    result.detachError = safeErrorMessage(err);
  }
  try {
    await client.deleteFile(fileId);
    result.fileDeleted = true;
  } catch (err) {
    result.fileDeleteError = safeErrorMessage(err);
  }
  result.deleted = result.detached || result.fileDeleted;
  return result;
}

async function uploadAndAttach(client, vectorStoreId, localFile, options = {}) {
  const file = await client.uploadFile(localFile);
  const fileId = String(file && file.id || "").trim();
  if (!fileId) throw new PublicOpenAiCatalogError("openai_file_upload_missing_id", 502);
  try {
    await client.attachFile(vectorStoreId, fileId, desiredAttributes(localFile, nowIso()));
    await waitForVectorStoreFile(client, vectorStoreId, fileId, options);
    return {
      fileId,
      filename: String(file.filename || localFile.uploadFilename || ""),
      relPath: localFile.relPath,
    };
  } catch (err) {
    try { await client.deleteFile(fileId); } catch {}
    throw err;
  }
}

async function waitForVectorStoreFile(client, vectorStoreId, fileId, options = {}) {
  const waitTimeoutMs = Math.max(0, Number(options.waitTimeoutMs || DEFAULT_WAIT_TIMEOUT_MS));
  const waitIntervalMs = Math.max(100, Number(options.waitIntervalMs || DEFAULT_WAIT_INTERVAL_MS));
  const started = Date.now();
  while (Date.now() - started <= waitTimeoutMs) {
    const file = await client.retrieveVectorStoreFile(vectorStoreId, fileId);
    const status = String(file && file.status || "");
    if (!status || status === "completed") return file;
    if (status === "failed" || status === "cancelled") {
      throw new PublicOpenAiCatalogError(`vector_store_file_${status}`, 502);
    }
    await sleep(waitIntervalMs);
  }
  throw new PublicOpenAiCatalogError("vector_store_file_timeout", 504);
}

function createOpenAiCatalogSync(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.env.FORYOU_DROPBOX_CATALOG_DIR || defaultRootDir());
  const enabled = isTruthyEnv(options.enabled !== undefined ? options.enabled : process.env.FORYOU_OPENAI_CATALOG_ENABLED, false);
  const apiKeyConfigured = !!String(options.apiKey || process.env.OPENAI_API_KEY || "").trim();
  const defaultVectorStoreId = normalizeVectorStoreId(options.vectorStoreId || process.env.FORYOU_OPENAI_VECTOR_STORE_ID || "");
  const model = normalizeText(options.model || process.env.FORYOU_OPENAI_MODEL || DEFAULT_MODEL, 80) || DEFAULT_MODEL;
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const client = options.client || createHttpOpenAiClient({
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
  });
  const waitOptions = {
    waitTimeoutMs: options.waitTimeoutMs,
    waitIntervalMs: options.waitIntervalMs,
  };

  function log(event, meta = {}) {
    try {
      logger(event, meta);
    } catch {}
  }

  function resolveVectorStoreId(value) {
    const id = normalizeVectorStoreId(value, defaultVectorStoreId);
    if (!id) throw new PublicOpenAiCatalogError("openai_vector_store_id_missing", 400);
    return id;
  }

  function assertReady(vectorStoreId = "") {
    if (!enabled) throw new PublicOpenAiCatalogError("openai_catalog_disabled", 400);
    if (!apiKeyConfigured && !options.client) throw new PublicOpenAiCatalogError("openai_api_key_missing", 400);
    return resolveVectorStoreId(vectorStoreId);
  }

  function getStatus() {
    const rootExists = fs.existsSync(rootDir);
    return {
      ok: true,
      enabled,
      ready: enabled && rootExists && (!!defaultVectorStoreId || !!options.client) && (apiKeyConfigured || !!options.client),
      apiKeyConfigured: apiKeyConfigured || !!options.client,
      vectorStoreId: defaultVectorStoreId,
      model,
      rootDir,
      rootExists,
      managedFilenamePrefix: MANAGED_FILENAME_PREFIX,
    };
  }

  async function listVectorStores() {
    if (!enabled) throw new PublicOpenAiCatalogError("openai_catalog_disabled", 400);
    if (!apiKeyConfigured && !options.client) throw new PublicOpenAiCatalogError("openai_api_key_missing", 400);
    const page = await client.listVectorStores({ limit: 100 });
    return {
      ok: true,
      vectorStores: (Array.isArray(page && page.data) ? page.data : []).map((store) => ({
        id: String(store.id || ""),
        name: String(store.name || ""),
        status: String(store.status || ""),
        fileCounts: store.file_counts || {},
        usageBytes: Number(store.usage_bytes || store.bytes || 0) || 0,
        createdAt: Number(store.created_at || 0) || 0,
      })),
    };
  }

  async function buildPlan(options = {}) {
    const vectorStoreId = assertReady(options.vectorStoreId);
    const localManifest = createLocalManifest(rootDir);
    const localByRelPath = new Map(localManifest.files.map((file) => [file.relPath, file]));
    const remoteManifest = await createRemoteManifest(client, vectorStoreId, {
      fetchContentHash: true,
      localByRelPath,
    });
    const plan = createPlanFromManifests(localManifest, remoteManifest);
    log("plan_created", {
      vectorStoreId,
      localFileCount: plan.localFileCount,
      remoteFileCount: plan.remoteFileCount,
      upload: plan.summary.upload,
      replace: plan.summary.replace,
      delete: plan.summary.delete,
      adopt: plan.summary.adopt,
      skip: plan.summary.skip,
    });
    return plan;
  }

  async function audit(options = {}) {
    const plan = await buildPlan(options);
    return {
      ...publicPlan(plan),
      status: getStatus(),
    };
  }

  async function syncPlan(options = {}) {
    return publicPlan(await buildPlan(options));
  }

  async function syncApply(options = {}) {
    if (String(options.confirm || "") !== "FULL_SYNC") {
      throw new PublicOpenAiCatalogError("confirmation_required", 400);
    }
    const vectorStoreId = assertReady(options.vectorStoreId);
    const plan = await buildPlan({ vectorStoreId });
    const applied = [];
    const errors = [];

    for (const action of plan.actions) {
      if (action.type === "skip") continue;
      try {
        if (action.type === "adopt") {
          const remote = action.remotes && action.remotes[0];
          if (!remote || !action.local) continue;
          await client.updateVectorStoreFileAttributes(vectorStoreId, remote.fileId || remote.id, desiredAttributes(action.local, nowIso()));
          applied.push({ type: "adopt", relPath: action.relPath, fileId: remote.fileId || remote.id });
        } else if (action.type === "upload") {
          const uploaded = await uploadAndAttach(client, vectorStoreId, action.local, waitOptions);
          applied.push({ type: "upload", relPath: action.relPath, fileId: uploaded.fileId });
        } else if (action.type === "replace") {
          const uploaded = await uploadAndAttach(client, vectorStoreId, action.local, waitOptions);
          const deleted = [];
          for (const remote of action.remotes || []) {
            deleted.push(await deleteManagedRemote(client, vectorStoreId, remote));
          }
          applied.push({ type: "replace", relPath: action.relPath, fileId: uploaded.fileId, deleted });
        } else if (action.type === "delete") {
          const deleted = [];
          for (const remote of action.remotes || []) {
            deleted.push(await deleteManagedRemote(client, vectorStoreId, remote));
          }
          applied.push({ type: "delete", relPath: action.relPath, deleted });
        }
      } catch (err) {
        errors.push({
          type: action.type,
          relPath: action.relPath || "",
          error: safeErrorMessage(err),
        });
      }
    }

    const ok = errors.length === 0;
    log("sync_apply_complete", {
      vectorStoreId,
      ok,
      applied: applied.length,
      errors: errors.length,
      upload: plan.summary.upload,
      replace: plan.summary.replace,
      delete: plan.summary.delete,
      adopt: plan.summary.adopt,
    });
    return {
      ok,
      vectorStoreId,
      summary: plan.summary,
      applied,
      errors,
      plan: publicPlan(plan),
    };
  }

  async function chat(options = {}) {
    const vectorStoreId = assertReady(options.vectorStoreId);
    const message = normalizeText(options.message, 8000);
    if (!message) throw new PublicOpenAiCatalogError("message_required", 400);
    const maxResults = Math.min(20, Math.max(1, Number.parseInt(String(options.maxResults || "8"), 10) || 8));
    const response = await client.createResponse({
      model,
      input: message,
      tools: [{
        type: "file_search",
        vector_store_ids: [vectorStoreId],
        max_num_results: maxResults,
      }],
      include: ["file_search_call.results"],
    });
    return {
      ok: true,
      vectorStoreId,
      model,
      text: extractResponseText(response),
      citations: extractCitations(response),
      searchResults: extractSearchResults(response),
      responseId: String(response.id || ""),
    };
  }

  return {
    getStatus,
    listVectorStores,
    audit,
    syncPlan,
    syncApply,
    chat,
    rootDir,
    enabled,
  };
}

module.exports = {
  MANAGED_FILENAME_PREFIX,
  createHttpOpenAiClient,
  createLocalManifest,
  createOpenAiCatalogSync,
  createPlanFromManifests,
  defaultRootDir,
  desiredAttributes,
  isSourceRelPath,
  publicPlan,
  relPathFromManagedFilename,
  uploadFilenameForRelPath,
};
