import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assetIndexPathFor, assetsDirFor, statePathFor } from "./paths.mjs";

const assetKinds = new Set(["upload", "generation", "edit"]);
const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const assetIndexLocks = new Map();

export class CanvasAssetNotFoundError extends Error {
  constructor({ canvasId, assetId }) {
    super("Asset " + JSON.stringify(assetId) + " was not found for canvas " + JSON.stringify(canvasId) + ".");
    this.name = "CanvasAssetNotFoundError";
    this.code = "canvas-asset-not-found";
    this.statusCode = 404;
  }
}

export async function registerCanvasAsset(projectDir, { canvasId, assetPath, object, kind = "upload" } = {}) {
  assertCanvasId(canvasId);
  const resolvedAssetPath = assertAssetPath(projectDir, canvasId, assetPath);
  return withAssetIndexLock(projectDir, canvasId, async () => {
    const index = await readAssetIndex(projectDir, canvasId);
    const existing = index.assets.find((asset) => asset.assetPath === resolvedAssetPath);
    const record = existing || createAssetRecord(resolvedAssetPath, object, kind);
    if (!existing) {
      index.assets.push(record);
      await writeAssetIndex(projectDir, canvasId, index);
    }
    return publicAsset(record, [object].filter(Boolean));
  });
}

export async function listCanvasAssets(projectDir, { canvasId } = {}) {
  assertCanvasId(canvasId);
  return withAssetIndexLock(projectDir, canvasId, () => listCanvasAssetsUnlocked(projectDir, canvasId));
}

async function listCanvasAssetsUnlocked(projectDir, canvasId) {
  const index = await readAssetIndex(projectDir, canvasId);
  const stateObjects = await readCanvasImageObjects(projectDir, canvasId);
  const indexedPaths = new Set(index.assets.map((asset) => asset.assetPath));
  let changed = false;

  for (const assetPath of await discoverAssetPaths(projectDir, canvasId)) {
    if (indexedPaths.has(assetPath)) continue;
    const object = stateObjects.find((candidate) => candidate.assetPath === assetPath) || null;
    index.assets.push(createAssetRecord(assetPath, object, object ? deriveAssetKind(object) : "upload"));
    changed = true;
  }

  if (changed) await writeAssetIndex(projectDir, canvasId, index);
  return index.assets
    .filter((asset) => isInsidePath(assetsDirFor(projectDir, canvasId), asset.assetPath))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id))
    .map((asset) => publicAsset(asset, stateObjects));
}

export async function canvasAssetFileMention(projectDir, { canvasId, assetId } = {}) {
  const asset = await storedCanvasAsset(projectDir, { canvasId, assetId });
  return "@" + asset.assetPath;
}
export async function insertCanvasAsset(projectDir, { canvasId, assetId } = {}) {
  const asset = await storedCanvasAsset(projectDir, { canvasId, assetId });
  const { reinsertStoredAsset } = await import("./store.mjs");
  return reinsertStoredAsset(projectDir, asset, { canvasId });
}

async function storedCanvasAsset(projectDir, { canvasId, assetId } = {}) {
  assertCanvasId(canvasId);
  if (typeof assetId !== "string" || !assetId.trim()) {
    const error = new Error("assetId must be a non-empty identifier.");
    error.code = "canvas-asset-invalid";
    error.statusCode = 400;
    throw error;
  }

  await listCanvasAssets(projectDir, { canvasId });
  const index = await readAssetIndex(projectDir, canvasId);
  const asset = index.assets.find((candidate) => candidate.id === assetId);
  if (!asset || !await assetFileExists(asset.assetPath)) {
    throw new CanvasAssetNotFoundError({ canvasId, assetId });
  }
  return asset;
}

function withAssetIndexLock(projectDir, canvasId, action) {
  const key = assetIndexPathFor(projectDir, canvasId);
  const previous = assetIndexLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  assetIndexLocks.set(key, current);
  return current.finally(() => {
    if (assetIndexLocks.get(key) === current) assetIndexLocks.delete(key);
  });
}
function createAssetRecord(assetPath, object, kind) {
  const now = new Date().toISOString();
  return {
    id: assetIdFor(assetPath),
    assetPath,
    name: displayAssetName(object, assetPath),
    src: "/assets/" + encodeURIComponent(path.basename(assetPath)),
    kind: assetKinds.has(kind) ? kind : deriveAssetKind(object),
    agentRunId: optionalReference(object?.agentRunId),
    jobId: optionalReference(object?.jobId),
    parentVersionId: optionalReference(object?.parentVersionId),
    batchId: optionalReference(object?.batchId),
    sourceObjectIds: sourceObjectIdsFor(object),
    createdAt: typeof object?.createdAt === "string" ? object.createdAt : now
  };
}

function publicAsset(asset, objects) {
  return {
    id: asset.id,
    name: asset.name,
    src: asset.src,
    kind: asset.kind,
    agentRunId: asset.agentRunId,
    jobId: asset.jobId,
    parentVersionId: asset.parentVersionId,
    batchId: asset.batchId,
    sourceObjectIds: [...asset.sourceObjectIds],
    createdAt: asset.createdAt,
    objectIds: objects
      .filter((object) => object?.type === "image" && object.assetPath === asset.assetPath)
      .map((object) => object.id)
  };
}

function deriveAssetKind(object) {
  if (object?.assetKind && assetKinds.has(object.assetKind)) return object.assetKind;
  if (object?.agentRunId || object?.jobId || object?.sourceObjectId) return "edit";
  return "upload";
}

function displayAssetName(object, assetPath) {
  const name = typeof object?.name === "string" ? object.name.trim() : "";
  return name ? name.slice(0, 300) : path.basename(assetPath);
}

function optionalReference(value) {
  return typeof value === "string" && value.trim() ? value.slice(0, 300) : null;
}
function sourceObjectIdsFor(object) {
  const ids = Array.isArray(object?.sourceObjectIds) ? object.sourceObjectIds : [];
  const sourceObjectId = typeof object?.sourceObjectId === "string" ? [object.sourceObjectId] : [];
  return [...new Set([...ids, ...sourceObjectId].filter((id) => typeof id === "string" && id.trim()))];
}

async function readAssetIndex(projectDir, canvasId) {
  const indexPath = assetIndexPathFor(projectDir, canvasId);
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, "utf8"));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.assets)) throw new Error("unsupported asset index schema");
    return {
      version: 1,
      assets: parsed.assets
        .filter(isStoredAsset)
        .map((asset) => ({
          ...asset,
          agentRunId: optionalReference(asset.agentRunId),
          jobId: optionalReference(asset.jobId),
          parentVersionId: optionalReference(asset.parentVersionId),
          batchId: optionalReference(asset.batchId),
          sourceObjectIds: [...asset.sourceObjectIds]
        }))
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, assets: [] };
    const wrapped = new Error("Asset index is corrupt: " + error.message, { cause: error });
    wrapped.code = "canvas-asset-index-corrupt";
    wrapped.statusCode = 500;
    throw wrapped;
  }
}

async function writeAssetIndex(projectDir, canvasId, index) {
  const indexPath = assetIndexPathFor(projectDir, canvasId);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const tempPath = indexPath + "." + process.pid + "." + Date.now() + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  try {
    await fs.writeFile(tempPath, JSON.stringify(index, null, 2) + "\n", { flag: "wx" });
    await fs.rename(tempPath, indexPath);
  } finally {
    await fs.unlink(tempPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function discoverAssetPaths(projectDir, canvasId) {
  const directory = assetsDirFor(projectDir, canvasId);
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readCanvasImageObjects(projectDir, canvasId) {
  try {
    const state = JSON.parse(await fs.readFile(statePathFor(projectDir, canvasId), "utf8"));
    return Array.isArray(state?.objects) ? state.objects : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function assertCanvasId(canvasId) {
  if (canvasId === null || canvasId === undefined) return;
  if (typeof canvasId !== "string" || !canvasId.trim() || canvasId.length > 300 || /[/\\\0\r\n]/.test(canvasId)) {
    const error = new Error("canvasId must be a path-safe identifier when provided.");
    error.code = "canvas-asset-invalid";
    error.statusCode = 400;
    throw error;
  }
}

function assertAssetPath(projectDir, canvasId, assetPath) {
  if (typeof assetPath !== "string" || !assetPath.trim()) {
    const error = new Error("assetPath must be a local canvas asset.");
    error.code = "canvas-asset-invalid";
    error.statusCode = 400;
    throw error;
  }
  const resolved = path.resolve(assetPath);
  if (!isInsidePath(assetsDirFor(projectDir, canvasId), resolved)) {
    const error = new Error("assetPath must stay inside this canvas's assets directory.");
    error.code = "canvas-asset-invalid";
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

function isStoredAsset(asset) {
  return asset
    && typeof asset === "object"
    && typeof asset.id === "string"
    && typeof asset.assetPath === "string"
    && typeof asset.name === "string"
    && typeof asset.src === "string"
    && assetKinds.has(asset.kind)
    && optionalStoredReference(asset.agentRunId)
    && optionalStoredReference(asset.jobId)
    && optionalStoredReference(asset.parentVersionId)
    && optionalStoredReference(asset.batchId)
    && Array.isArray(asset.sourceObjectIds)
    && typeof asset.createdAt === "string";
}

function optionalStoredReference(value) {
  return value === undefined || value === null || typeof value === "string";
}
function assetIdFor(assetPath) {
  return "asset_" + crypto.createHash("sha256").update(path.basename(assetPath).toLowerCase()).digest("hex").slice(0, 16);
}

async function assetFileExists(assetPath) {
  try {
    return (await fs.stat(assetPath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isInsidePath(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}