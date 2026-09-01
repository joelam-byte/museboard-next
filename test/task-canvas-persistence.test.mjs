import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateLegacyTaskCanvas } from "../src/legacy-canvas-migration.mjs";
import { canvasDataDirFor } from "../src/paths.mjs";
import { canvasIdForThread } from "../src/runtime.mjs";
import { createServer } from "../src/server.mjs";

async function createLegacyCanvas(legacyRoot, threadId, marker = "legacy") {
  const sourceDir = path.join(legacyRoot, "threads", threadId);
  await fs.mkdir(path.join(sourceDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "codex-canvas.json"), JSON.stringify({ marker }));
  await fs.writeFile(path.join(sourceDir, "assets", "reference.png"), marker);
  return sourceDir;
}

test("migrates one temporary task canvas into its persistent thread canvas without deleting the source", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-task-canvas-"));
  const legacyRoot = path.join(projectDir, "legacy-canvas");
  const threadId = "thread-existing-test-canvas";
  const canvasId = "thread-existing-test-canvas-hash";
  const sourceDir = await createLegacyCanvas(legacyRoot, threadId);

  const result = await migrateLegacyTaskCanvas({ projectDir, threadId, canvasId, legacyRoot });
  const destinationDir = canvasDataDirFor(projectDir, canvasId);

  assert.deepEqual(result, {
    migrated: true,
    sourceDir,
    destinationDir,
    conflict: null
  });
  assert.equal(await fs.readFile(path.join(destinationDir, "assets", "reference.png"), "utf8"), "legacy");
  assert.equal(await fs.readFile(path.join(sourceDir, "assets", "reference.png"), "utf8"), "legacy");
});

test("refuses to overwrite a non-empty persistent canvas during migration", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-task-canvas-conflict-"));
  const legacyRoot = path.join(projectDir, "legacy-canvas");
  const threadId = "thread-existing-conflict";
  const canvasId = "thread-existing-conflict-hash";
  await createLegacyCanvas(legacyRoot, threadId, "legacy");
  const destinationDir = canvasDataDirFor(projectDir, canvasId);
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.writeFile(path.join(destinationDir, "codex-canvas.json"), JSON.stringify({ marker: "persistent" }));

  const result = await migrateLegacyTaskCanvas({ projectDir, threadId, canvasId, legacyRoot });

  assert.deepEqual(result, {
    migrated: false,
    sourceDir: path.join(legacyRoot, "threads", threadId),
    destinationDir,
    conflict: "destination-not-empty"
  });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(destinationDir, "codex-canvas.json"), "utf8")), { marker: "persistent" });
});

test("treats a repeated migration as a no-op after the persistent canvas exists", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-task-canvas-repeat-"));
  const legacyRoot = path.join(projectDir, "legacy-canvas");
  const threadId = "thread-existing-repeat";
  const canvasId = "thread-existing-repeat-hash";
  await createLegacyCanvas(legacyRoot, threadId);

  await migrateLegacyTaskCanvas({ projectDir, threadId, canvasId, legacyRoot });
  const repeated = await migrateLegacyTaskCanvas({ projectDir, threadId, canvasId, legacyRoot });

  assert.equal(repeated.migrated, false);
  assert.equal(repeated.conflict, "destination-not-empty");
});

test("registering a bound task migrates its legacy canvas before creating an empty store", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-task-canvas-server-"));
  const legacyRoot = path.join(projectDir, "legacy-canvas");
  const threadId = "thread-server-migration";
  const canvasId = canvasIdForThread(threadId);
  await createLegacyCanvas(legacyRoot, threadId, "migrated-by-server");

  const { server } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    chatThreadId: threadId,
    legacyCanvasRoot: legacyRoot,
    persistentRegistryPath: path.join(projectDir, "registry.json")
  });

  try {
    const state = JSON.parse(await fs.readFile(path.join(canvasDataDirFor(projectDir, canvasId), "codex-canvas.json"), "utf8"));
    assert.equal(state.marker, "migrated-by-server");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a reopened bound task restores auto-collection even when its old test registry disabled it", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-task-canvas-autocollect-"));
  const registryPath = path.join(projectDir, "registry.json");
  const threadId = "thread-auto-collect";
  const canvasId = canvasIdForThread(threadId);
  await fs.writeFile(registryPath, JSON.stringify({
    projects: [{
      projectDir,
      canvasId,
      chatThreadId: threadId,
      autoCollect: false,
      registeredAt: "2026-08-31T00:00:00.000Z"
    }],
    aliases: []
  }));

  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: true,
    chatThreadId: threadId,
    persistentRegistryPath: registryPath,
    generatedImagesRoot: path.join(projectDir, "generated-images")
  });

  try {
    const response = await fetch(`${url.replace(/\?.*/, "")}api/projects`);
    const body = await response.json();
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0].autoCollect, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
