import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareAgentRunForJob, recordAgentRunJobFailure, recordAgentRunJobSuccess } from "../src/agent-run-execution.mjs";
import { readAgentRun } from "../src/agent-run-store.mjs";

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
