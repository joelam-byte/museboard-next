import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgentRun } from "../src/agent-run-contracts.mjs";
import { listAgentRuns, writeAgentRun } from "../src/agent-run-store.mjs";
import { addImage, deleteObject } from "../src/store.mjs";
import { insertCanvasAsset, listCanvasAssets } from "../src/asset-library.mjs";

test("lists one canvas's AgentRuns newest first with a bounded limit", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-history-runs-"));
  const canvasId = "history-canvas";
  const older = createAgentRun({
    id: "run-older",
    canvasId,
    sourceObjectIds: ["source-older"],
    rawRequest: "Make the product image brighter."
  }, { now: "2026-08-30T10:00:00.000Z" });
  const newer = createAgentRun({
    id: "run-newer",
    canvasId,
    sourceObjectIds: ["source-newer"],
    rawRequest: "Create a warm campaign image."
  }, { now: "2026-08-30T10:01:00.000Z" });
  const otherCanvas = createAgentRun({
    id: "run-other",
    canvasId: "other-canvas",
    sourceObjectIds: ["source-other"],
    rawRequest: "This run belongs to another canvas."
  }, { now: "2026-08-30T10:02:00.000Z" });

  await Promise.all([
    writeAgentRun(projectDir, older),
    writeAgentRun(projectDir, newer),
    writeAgentRun(projectDir, otherCanvas)
  ]);

  const history = await listAgentRuns(projectDir, { canvasId, limit: 10 });
  assert.deepEqual(history.map((run) => run.id), ["run-newer", "run-older"]);

  const latestOnly = await listAgentRuns(projectDir, { canvasId, limit: 1 });
  assert.deepEqual(latestOnly.map((run) => run.id), ["run-newer"]);
});
test("retains an uploaded asset after canvas deletion and reinserts its original file", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-history-assets-"));
  const canvasId = "asset-canvas";
  const uploaded = await addImage(projectDir, {
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    name: "packshot.png",
    allowDuplicate: true,
    agentRunId: "run-packshot",
    jobId: "job-packshot",
    parentVersionId: "version-packshot",
    batchId: "batch-packshot",
    sourceObjectIds: ["source-packshot"]
  }, { canvasId });

  const initialAssets = await listCanvasAssets(projectDir, { canvasId });
  assert.equal(initialAssets.length, 1);
  assert.equal(initialAssets[0].kind, "upload");
  assert.deepEqual(initialAssets[0].objectIds, [uploaded.id]);
  assert.equal(initialAssets[0].agentRunId, "run-packshot");
  assert.equal(initialAssets[0].jobId, "job-packshot");
  assert.equal(initialAssets[0].parentVersionId, "version-packshot");
  assert.equal(initialAssets[0].batchId, "batch-packshot");
  assert.deepEqual(initialAssets[0].sourceObjectIds, ["source-packshot"]);

  await deleteObject(projectDir, uploaded.id, { canvasId });

  const retainedAssets = await listCanvasAssets(projectDir, { canvasId });
  assert.equal(retainedAssets.length, 1);
  assert.equal(retainedAssets[0].id, initialAssets[0].id);
  assert.deepEqual(retainedAssets[0].objectIds, []);
  await fs.access(uploaded.assetPath);

  const reinserted = await insertCanvasAsset(projectDir, {
    canvasId,
    assetId: retainedAssets[0].id
  });
  assert.notEqual(reinserted.id, uploaded.id);
  assert.equal(reinserted.assetPath, uploaded.assetPath);
  assert.equal(reinserted.agentRunId, "run-packshot");
  assert.equal(reinserted.jobId, "job-packshot");
  assert.equal(reinserted.parentVersionId, "version-packshot");
  assert.equal(reinserted.batchId, "batch-packshot");
  assert.deepEqual(reinserted.sourceObjectIds, ["source-packshot"]);
});
test("records concurrent asset imports without losing either manifest record", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-history-assets-race-"));
  const canvasId = "asset-race-canvas";
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const expectedNames = Array.from({ length: 8 }, (_, index) => "campaign-" + index + ".png");
  await Promise.all(expectedNames.map((name) => addImage(
    projectDir,
    { dataUrl, name, allowDuplicate: true, assetKind: "generation" },
    { canvasId }
  )));

  const assets = await listCanvasAssets(projectDir, { canvasId });
  assert.equal(assets.length, expectedNames.length);
  for (const name of expectedNames) assert.ok(assets.some((asset) => asset.name.endsWith(name)));
  assert.ok(assets.every((asset) => asset.kind === "generation"));
});
