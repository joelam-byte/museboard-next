import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { prepareAgentRunForJob } from "../src/agent-run-execution.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function readyCandidate() {
  return {
    recommendedSkillId: "quick-edit",
    structuredBrief: {
      modifications: ["Replace the background with a warm studio setting."],
      preservationRules: ["Keep the product shape and logo unchanged."],
      style: "Warm editorial product photography",
      materials: ["matte paper"],
      composition: "Centered product with generous title space",
      textRequirements: [],
      outputRequirements: ["One PNG image at 1080 by 1440 pixels."]
    },
    clarificationQuestions: [],
    optimizedPrompt: "Create a warm product image while preserving the product and logo.",
    plannedOutputs: [{
      id: "output-main",
      label: "Main image",
      purpose: "Primary campaign image",
      format: "png",
      width: 1080,
      height: 1440,
      aspectRatio: "3:4",
      status: "planned",
      jobId: null,
      outputObjectIds: [],
      error: null
    }]
  };
}

test("AgentRun API returns a validated brief without creating an image job", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-api-"));
  const persistentRegistryPath = path.join(projectDir, "registry.json");
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath,
    agentAnalyzer: async () => readyCandidate()
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;

  try {
    const skillsResponse = await fetch(`${base}api/skills${search}`);
    assert.equal(skillsResponse.status, 200);
    const skills = await skillsResponse.json();
    assert.deepEqual(skills.skills.map((skill) => skill.id), [
      "quick-edit", "expand", "remove-bg", "edit-text", "edit-elements", "xiaohongshu-cover", "product-marketing-set"
    ]);

    const imageResponse = await fetch(`${base}api/images${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${pngOne}`,
        name: "source.png"
      })
    });
    assert.equal(imageResponse.status, 201);
    const image = await imageResponse.json();

    const response = await fetch(`${base}api/agent-runs${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "agent-panel-run-1",
        sourceObjectIds: [image.id],
        rawRequest: "Make this a warm product campaign visual while keeping the logo."
      })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.agentRun.id, "agent-panel-run-1");
    assert.equal(body.agentRun.status, "ready");
    assert.equal(body.agentRun.selectedSkillId, "quick-edit");
    assert.deepEqual(body.agentRun.childJobIds, []);

    const stateResponse = await fetch(`${base}api/state${search}`);
    const state = await stateResponse.json();
    assert.equal(state.objects.filter((object) => object.type === "job").length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("AgentRun API persists clarification answers and a user-selected Skill", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-api-followup-"));
  const persistentRegistryPath = path.join(projectDir, "registry.json");
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath,
    agentAnalyzer: async (context) => {
      if (context.request.clarificationAnswers.headline) return readyCandidate();
      return {
        ...readyCandidate(),
        clarificationQuestions: [{
          id: "headline",
          prompt: "What exact headline should appear?",
          required: true,
          options: []
        }]
      };
    }
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;

  try {
    const imageResponse = await fetch(`${base}api/images${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${pngOne}`, name: "source.png" })
    });
    const image = await imageResponse.json();

    const createdResponse = await fetch(`${base}api/agent-runs${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "agent-panel-run-2",
        sourceObjectIds: [image.id],
        rawRequest: "Create a campaign visual with a new headline."
      })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.agentRun.status, "needs_clarification");

    const answeredResponse = await fetch(`${base}api/agent-runs/agent-panel-run-2/answers${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { headline: "Warm studio launch" } })
    });
    assert.equal(answeredResponse.status, 200);
    const answered = await answeredResponse.json();
    assert.equal(answered.agentRun.status, "ready");
    assert.equal(answered.agentRun.clarificationAnswers.headline, "Warm studio launch");

    const selectedResponse = await fetch(`${base}api/agent-runs/agent-panel-run-2${search}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedSkillId: "expand",
        optimizedPrompt: "Extend the campaign scene around the original product."
      })
    });
    assert.equal(selectedResponse.status, 200);
    const selected = await selectedResponse.json();
    assert.equal(selected.agentRun.selectedSkillId, "expand");

    const fetchedResponse = await fetch(`${base}api/agent-runs/agent-panel-run-2${search}`);
    assert.equal(fetchedResponse.status, 200);
    const fetched = await fetchedResponse.json();
    assert.equal(fetched.agentRun.selectedSkillId, "expand");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("AgentRun confirmation starts one existing image job and is idempotent", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-confirm-"));
  const persistentRegistryPath = path.join(projectDir, "registry.json");
  let successfulStarts = 0;
  let attemptedStarts = 0;
  const imageJobFactory = async (_projectDir, input) => {
    attemptedStarts += 1;
    const jobId = `job-confirmed-${attemptedStarts}`;
    const run = await prepareAgentRunForJob(projectDir, {
      canvasId: "shared",
      agentRunId: input.agentRunId,
      jobId,
      action: input.action,
      sourceObject: { id: input.objectId },
      prompt: input.prompt
    });
    successfulStarts += 1;
    return {
      id: jobId,
      action: input.action,
      status: "queued",
      agentRunId: run.id
    };
  };
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath,
    agentAnalyzer: async () => readyCandidate(),
    imageJobFactory
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;

  try {
    const imageResponse = await fetch(`${base}api/images${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${pngOne}`, name: "source.png" })
    });
    const image = await imageResponse.json();

    const createdResponse = await fetch(`${base}api/agent-runs${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "agent-confirm-run",
        sourceObjectIds: [image.id],
        rawRequest: "Place this product in a warm studio while preserving the logo."
      })
    });
    assert.equal(createdResponse.status, 201);

    const selectedResponse = await fetch(`${base}api/agent-runs/agent-confirm-run${search}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedSkillId: "expand",
        optimizedPrompt: "Extend the studio scene around the original product."
      })
    });
    assert.equal(selectedResponse.status, 200);
    const selected = await selectedResponse.json();
    assert.equal(selected.agentRun.recommendedSkillId, "quick-edit");
    assert.equal(selected.agentRun.selectedSkillId, "expand");

    const [firstResponse, secondResponse] = await Promise.all([
      fetch(`${base}api/agent-runs/agent-confirm-run/confirm${search}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }),
      fetch(`${base}api/agent-runs/agent-confirm-run/confirm${search}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      })
    ]);
    assert.equal(firstResponse.status, 202);
    assert.equal(secondResponse.status, 202);
    const [first, second] = await Promise.all([firstResponse.json(), secondResponse.json()]);
    assert.equal(first.agentRun.status, "running");
    assert.equal(second.agentRun.status, "running");
    assert.equal(first.imageJob.id, "job-confirmed-1");
    assert.equal(second.imageJob.id, "job-confirmed-1");
    assert.equal(successfulStarts, 1);
    assert.equal(first.imageJob.action, "expand");

    const fetchedResponse = await fetch(`${base}api/agent-runs/agent-confirm-run${search}`);
    const fetched = await fetchedResponse.json();
    assert.deepEqual(fetched.agentRun.childJobIds, ["job-confirmed-1"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
