import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectRecentImages } from "../src/collector.mjs";
import { addImage, addJobPlaceholder } from "../src/store.mjs";
import { listCanvasAssets } from "../src/asset-library.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngTwo = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGO8Y6D6n4GBgYEJRIAwACHvAjSDKprFAAAAAElFTkSuQmCC";

test("job placeholders and collected results preserve lightweight AgentRun provenance", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-provenance-"));
  const canvasId = "canvas-provenance";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });

  const placeholder = await addJobPlaceholder(projectDir, {
    id: "job-provenance-placeholder",
    action: "quick-edit",
    sourceObjectId: source.id,
    agentRunId: "run-job-provenance",
    sourceObjectIds: [source.id],
    jobId: "job-provenance"
  }, { canvasId });
  assert.equal(placeholder.agentRunId, "run-job-provenance");
  assert.equal(placeholder.jobId, "job-provenance");
  assert.deepEqual(placeholder.sourceObjectIds, [source.id]);

  const outputDir = path.join(projectDir, "temporary-output");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "result.png");
  await fs.writeFile(outputPath, Buffer.from(pngTwo, "base64"));

  const collected = await collectRecentImages(projectDir, {
    roots: [outputDir],
    sinceMs: 0,
    sourceObjectId: source.id,
    agentRunId: "run-job-provenance",
    sourceObjectIds: [source.id],
    jobId: "job-provenance",
    assetKind: "edit",
    canvasId
  });
  assert.equal(collected.imported.length, 1);
  assert.equal(collected.imported[0].agentRunId, "run-job-provenance");
  assert.equal(collected.imported[0].jobId, "job-provenance");
  assert.deepEqual(collected.imported[0].sourceObjectIds, [source.id]);

  const assets = await listCanvasAssets(projectDir, { canvasId });
  const collectedAsset = assets.find((asset) => asset.objectIds.includes(collected.imported[0].id));
  assert.equal(collectedAsset.kind, "edit");
});
