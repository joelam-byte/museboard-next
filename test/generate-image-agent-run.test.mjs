import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareAgentRunForGenerationJob } from "../src/agent-run-execution.mjs";
import { createServer } from "../src/server.mjs";

function generationCandidate() {
  return {
    recommendedSkillId: "generate-image",
    structuredBrief: {
      modifications: ["Create a clean product hero image from the request."],
      preservationRules: [],
      style: "Clean studio product photography",
      materials: [],
      composition: "Centered product with generous negative space",
      textRequirements: [],
      outputRequirements: ["One PNG image at 1024 by 1024 pixels."]
    },
    clarificationQuestions: [],
    optimizedPrompt: "Create a clean studio hero image of a modern white desk lamp on a warm neutral background.",
    plannedOutputs: [{
      id: "image",
      label: "Generated image",
      purpose: "A new image created without a canvas reference.",
      format: "png",
      width: 1024,
      height: 1024,
      aspectRatio: "1:1",
      status: "planned",
      jobId: null,
      outputObjectIds: [],
      error: null
    }]
  };
}

test("a zero-source AgentRun can analyze and confirm the generate-image Skill exactly once", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-generate-image-agent-"));
  const starts = [];
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath: path.join(projectDir, "registry.json"),
    agentAnalyzer: async (context) => {
      assert.deepEqual(context.sources, []);
      assert.deepEqual(context.request.sourceObjectIds, []);
      return generationCandidate();
    },
    generationJobFactory: async (_projectDir, input, options) => {
      starts.push(input);
      await prepareAgentRunForGenerationJob(projectDir, {
        canvasId: options.canvasId || "shared",
        agentRunId: input.agentRunId,
        jobId: "job-generated-once",
        action: input.action
      });
      return {
        id: "job-generated-once",
        action: "generate-image",
        status: "queued",
        agentRunId: input.agentRunId,
        placeholder: { id: "job-generated-once_placeholder" }
      };
    }
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;

  try {
    const analyzedResponse = await fetch(`${base}api/agent-runs${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "run-generate-image",
        sourceObjectIds: [],
        rawRequest: "Create a clean studio hero image of a modern white desk lamp."
      })
    });
    assert.equal(analyzedResponse.status, 201);
    const analyzed = await analyzedResponse.json();
    assert.equal(analyzed.agentRun.selectedSkillId, "generate-image");
    assert.equal(analyzed.agentRun.status, "ready");

    const firstConfirm = await fetch(`${base}api/agent-runs/run-generate-image/confirm${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(firstConfirm.status, 202);
    const firstResult = await firstConfirm.json();
    assert.equal(firstResult.agentRun.status, "running");
    assert.equal(firstResult.imageJob.id, "job-generated-once");

    const repeatedConfirm = await fetch(`${base}api/agent-runs/run-generate-image/confirm${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(repeatedConfirm.status, 202);
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0], {
      action: "generate-image",
      prompt: generationCandidate().optimizedPrompt,
      agentRunId: "run-generate-image",
      output: generationCandidate().plannedOutputs[0]
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("zero-source AgentRun rejects an image-edit Skill before an image job is created", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-generate-image-invalid-skill-"));
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath: path.join(projectDir, "registry.json"),
    agentAnalyzer: async () => ({ ...generationCandidate(), recommendedSkillId: "quick-edit" })
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;

  try {
    const response = await fetch(`${base}api/agent-runs${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "run-zero-source-edit",
        sourceObjectIds: [],
        rawRequest: "Make this product image brighter."
      })
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /source image|reference|generate-image/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
