import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const publicDir = path.join(pluginRoot, "public");
export const maxSafePathSegmentLength = 120;
const windowsReservedPathSegments = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
]);

export function resolveProjectDir(value) {
  return path.resolve(value || process.env.CODEX_CANVAS_PROJECT_DIR || process.cwd());
}

export function dataDirFor(projectDir) {
  return path.join(projectDir, "canvas");
}

export function canvasDataDirFor(projectDir, canvasId = null) {
  return canvasId ? path.join(dataDirFor(projectDir), "threads", storagePathSegment(canvasId)) : dataDirFor(projectDir);
}

export function legacyCanvasDataDirFor(projectDir, canvasId = null) {
  return canvasId ? path.join(dataDirFor(projectDir), "threads", safePathSegment(canvasId)) : dataDirFor(projectDir);
}

export function statePathFor(projectDir, canvasId = null) {
  return path.join(canvasDataDirFor(projectDir, canvasId), "codex-canvas.json");
}

export function assetsDirFor(projectDir, canvasId = null) {
  return path.join(canvasDataDirFor(projectDir, canvasId), "assets");
}

export function jobsDirFor(projectDir, canvasId = null) {
  return path.join(canvasDataDirFor(projectDir, canvasId), "jobs");
}

export function agentRunsDirFor(projectDir, canvasId) {
  return path.join(canvasDataDirFor(projectDir, canvasId), "runs");
}

export function agentRunDirFor(projectDir, canvasId, agentRunId) {
  return path.join(agentRunsDirFor(projectDir, canvasId), storagePathSegment(agentRunId));
}

export function agentRunPathFor(projectDir, canvasId, agentRunId) {
  return path.join(agentRunDirFor(projectDir, canvasId, agentRunId), "run.json");
}

export function runtimePathFor(projectDir) {
  return path.join(dataDirFor(projectDir), ".codex-canvas-runtime.json");
}

export function projectRegistryPath() {
  return path.resolve(
    process.env.CODEX_CANVAS_PROJECT_REGISTRY_PATH
    || path.join(os.homedir(), ".agents", "codex-canvas", "projects.json")
  );
}

export function safePathSegment(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, maxSafePathSegmentLength) || "default";
}

function storagePathSegment(value) {
  const raw = String(value || "default");
  const safe = safePathSegment(raw);
  if (safe === raw && raw.length <= maxSafePathSegmentLength && isCrossPlatformStorageSegment(raw)) return safe;

  const hash = crypto.createHash("sha256").update(raw).digest("base64url").slice(0, 12);
  const readableLength = maxSafePathSegmentLength - hash.length - 1;
  const readable = safe.slice(0, readableLength) || "id";
  return `${readable}-${hash}`;
}

function isCrossPlatformStorageSegment(value) {
  if (value === "." || value === ".." || /[. ]$/.test(value)) return false;
  const baseName = value.split(".", 1)[0].toUpperCase();
  return !windowsReservedPathSegments.has(baseName);
}
