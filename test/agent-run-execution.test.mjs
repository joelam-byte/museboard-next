import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgentRun, transitionAgentRun } from "../src/agent-run-contracts.mjs";
import { prepareAgentRunForJob, recordAgentRunJobFailure, recordAgentRunJobSuccess, retryAgentRunJobs, startAgentRunBatch } from "../src/agent-run-execution.mjs";
import { readAgentRun, writeAgentRun } from "../src/agent-run-store.mjs";

const existingImageSkills = ["quick-edit", "expand", "remove-bg", "edit-text", "edit-elements"];

test("existing image actions create a running AgentRun with an explicit one-job plan", async (t) => {
  for (const action of existingImageSkills) {
    await t.test(action, async () => {
      const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), `museboard-agent-execution-${action}-`));
      const run = await prepareAgentRunForJob(projectDir, {
        canvasId: "canvas-execution",
        jobId: `job-${action}`,
        action,
        sourceObject: {
          id: "source-image",
          naturalWidth: 1200,
          naturalHeight: 800
        },
        prompt: "Keep the product structure and make the requested edit."
      });

      assert.equal(run.status, "running");
      assert.equal(run.recommendedSkillId, action);
      assert.equal(run.selectedSkillId, action);
      assert.deepEqual(run.sourceObjectIds, ["source-image"]);
      assert.deepEqual(run.childJobIds, [`job-${action}`]);
      assert.deepEqual(run.plannedOutputs, [{
        id: "output-main",
        label: "Result",
        purpose: "Result from the selected existing image-edit Skill.",
        format: "png",
        width: 1200,
        height: 800,
        aspectRatio: "source",
        status: "running",
        jobId: `job-${action}`,
        outputObjectIds: [],
        error: null
      }]);
      assert.deepEqual(await readAgentRun(projectDir, {
        canvasId: "canvas-execution",
        agentRunId: run.id
      }), run);
    });
  }
});

test("a completed image job records all placed objects and succeeds its AgentRun", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-execution-success-"));
  const running = await prepareAgentRunForJob(projectDir, {
    canvasId: "canvas-execution-success",
    jobId: "job-success",
    action: "edit-elements",
    sourceObject: { id: "source-image", naturalWidth: 1200, naturalHeight: 800 },
    prompt: "Separate editable image elements."
  });

  const completed = await recordAgentRunJobSuccess(projectDir, {
    canvasId: running.canvasId,
    agentRunId: running.id,
    jobId: "job-success",
    outputObjectIds: ["layer-background", "layer-product", "layer-title"]
  });

  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.outputObjectIds, ["layer-background", "layer-product", "layer-title"]);
  assert.deepEqual(completed.plannedOutputs[0], {
    ...running.plannedOutputs[0],
    status: "succeeded",
    outputObjectIds: ["layer-background", "layer-product", "layer-title"]
  });
});

test("a failed image job records a retryable failure without losing its AgentRun", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-execution-failure-"));
  const running = await prepareAgentRunForJob(projectDir, {
    canvasId: "canvas-execution-failure",
    jobId: "job-failure",
    action: "remove-bg",
    sourceObject: { id: "source-image", naturalWidth: 1200, naturalHeight: 800 },
    prompt: "Remove the background."
  });

  const failed = await recordAgentRunJobFailure(projectDir, {
    canvasId: running.canvasId,
    agentRunId: running.id,
    jobId: "job-failure",
    error: new Error("The image service did not return an output.")
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.plannedOutputs[0].status, "failed");
  assert.equal(failed.plannedOutputs[0].jobId, "job-failure");
  assert.equal(failed.plannedOutputs[0].error.code, "image-job-failed");
  assert.equal(failed.error.code, "image-job-failed");
  assert.match(failed.error.message, /did not return an output/);
  assert.deepEqual(await readAgentRun(projectDir, {
    canvasId: running.canvasId,
    agentRunId: running.id
  }), failed);
});

test("product marketing outputs settle partial and retry only the failed item", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-product-set-"));
  const canvasId = "canvas-product-set";
  const agentRunId = "run-product-set";
  const ready = transitionAgentRun(createAgentRun({
    id: agentRunId,
    canvasId,
    sourceObjectIds: ["source-product"],
    rawRequest: "Create a product marketing image set with a main image, benefit image, lifestyle scene, and detail image."
  }), "ready", {
    recommendedSkillId: "product-marketing-set",
    selectedSkillId: "product-marketing-set",
    structuredBrief: productMarketingBrief(),
    optimizedPrompt: "Create a consistent four-image product marketing set.",
    plannedOutputs: productMarketingOutputs()
  });
  await writeAgentRun(projectDir, ready);

  const running = await startAgentRunBatch(projectDir, {
    canvasId,
    agentRunId,
    action: "product-marketing-set",
    sourceObjectIds: ["source-product"],
    skillInputs: {
      "sales-channel": "Marketplace listing",
      "primary-benefit": "Double-wall insulation keeps drinks warm for longer.",
      "target-audience": "Daily commuters",
      "visual-style": "Clean studio",
      "preserve-elements": "Keep the lid geometry and logo."
    },
    jobs: [
      { id: "job-main", outputId: "main" },
      { id: "job-benefit", outputId: "benefit" },
      { id: "job-scene", outputId: "scene" },
      { id: "job-detail", outputId: "detail" }
    ]
  });
  assert.equal(running.status, "running");
  assert.deepEqual(running.childJobIds, ["job-main", "job-benefit", "job-scene", "job-detail"]);
  assert.deepEqual(running.plannedOutputs.map((output) => [output.id, output.status, output.jobId]), [
    ["main", "running", "job-main"],
    ["benefit", "running", "job-benefit"],
    ["scene", "running", "job-scene"],
    ["detail", "running", "job-detail"]
  ]);

  await recordAgentRunJobSuccess(projectDir, {
    canvasId,
    agentRunId,
    jobId: "job-main",
    outputObjectIds: ["image-main"]
  });
  await recordAgentRunJobFailure(projectDir, {
    canvasId,
    agentRunId,
    jobId: "job-benefit",
    error: new Error("Benefit image generation failed.")
  });
  await recordAgentRunJobSuccess(projectDir, {
    canvasId,
    agentRunId,
    jobId: "job-scene",
    outputObjectIds: ["image-scene"]
  });
  const partial = await recordAgentRunJobSuccess(projectDir, {
    canvasId,
    agentRunId,
    jobId: "job-detail",
    outputObjectIds: ["image-detail"]
  });
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.outputObjectIds, ["image-main", "image-scene", "image-detail"]);
  assert.equal(partial.plannedOutputs.find((output) => output.id === "benefit").error.retryable, true);

  const retried = await retryAgentRunJobs(projectDir, {
    canvasId,
    agentRunId,
    jobs: [{ id: "job-benefit-retry", outputId: "benefit" }]
  });
  assert.equal(retried.status, "running");
  assert.deepEqual(retried.childJobIds, ["job-main", "job-benefit", "job-scene", "job-detail", "job-benefit-retry"]);
  assert.deepEqual(retried.plannedOutputs.map((output) => [output.id, output.status, output.jobId]), [
    ["main", "succeeded", "job-main"],
    ["benefit", "running", "job-benefit-retry"],
    ["scene", "succeeded", "job-scene"],
    ["detail", "succeeded", "job-detail"]
  ]);

  const succeeded = await recordAgentRunJobSuccess(projectDir, {
    canvasId,
    agentRunId,
    jobId: "job-benefit-retry",
    outputObjectIds: ["image-benefit-retry"]
  });
  assert.equal(succeeded.status, "succeeded");
  assert.deepEqual(succeeded.outputObjectIds, ["image-main", "image-benefit-retry", "image-scene", "image-detail"]);
});

function productMarketingBrief() {
  return {
    modifications: ["Create a coordinated product marketing image set."],
    preservationRules: ["Keep the product identity and visible logo accurate."],
    style: "Clean premium e-commerce photography",
    materials: [],
    composition: "Adapt each composition to its marketing purpose.",
    textRequirements: [],
    outputRequirements: ["Four PNG outputs: main, benefit, scene, and detail."]
  };
}

function productMarketingOutputs() {
  return [
    ["main", "Main image", "Primary listing image"],
    ["benefit", "Benefit image", "Key benefit image"],
    ["scene", "Scene image", "Lifestyle scene image"],
    ["detail", "Detail image", "Product detail image"]
  ].map(([id, label, purpose]) => ({
    id,
    label,
    purpose,
    format: "png",
    width: 1080,
    height: 1350,
    aspectRatio: "4:5",
    status: "planned",
    jobId: null,
    outputObjectIds: [],
    error: null
  }));
}
