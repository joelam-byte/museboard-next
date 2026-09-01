import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canvasDataDirFor, safePathSegment } from "./paths.mjs";

const defaultLegacyCanvasRoot = path.join(os.tmpdir(), "museboard-local-e2e-demo", "canvas");

export async function migrateLegacyTaskCanvas({ projectDir, threadId, canvasId, legacyRoot = defaultLegacyCanvasRoot }) {
  const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
  const destinationDir = canvasDataDirFor(projectDir, canvasId);
  if (!normalizedThreadId) {
    return { migrated: false, sourceDir: null, destinationDir, conflict: null };
  }

  const sourceDir = path.join(path.resolve(legacyRoot), "threads", safePathSegment(normalizedThreadId));
  if (!await directoryExists(sourceDir)) {
    return { migrated: false, sourceDir, destinationDir, conflict: null };
  }
  if (!await directoryIsEmpty(destinationDir)) {
    return { migrated: false, sourceDir, destinationDir, conflict: "destination-not-empty" };
  }

  await fs.mkdir(path.dirname(destinationDir), { recursive: true });
  if (await directoryExists(destinationDir)) await fs.rmdir(destinationDir);
  await fs.cp(sourceDir, destinationDir, { recursive: true, errorOnExist: true, force: false });
  return { migrated: true, sourceDir, destinationDir, conflict: null };
}

async function directoryExists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function directoryIsEmpty(directory) {
  try {
    return (await fs.readdir(directory)).length === 0;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    if (error?.code === "ENOTDIR") return false;
    throw error;
  }
}
