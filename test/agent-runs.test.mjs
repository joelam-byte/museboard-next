import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SKILL_DESCRIPTORS,
  SKILL_IDS,
  createAgentRun,
  transitionAgentRun,
  validateAgentRun,
  validateSkillDescriptor,
  validateStructuredBrief
} from "../src/agent-run-contracts.mjs";
import { readAgentRun, updateAgentRun, writeAgentRun } from "../src/agent-run-store.mjs";
import { agentRunPathFor, statePathFor } from "../src/paths.mjs";
import { addImage, readState } from "../src/store.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const expectedSkillIds = [
  "quick-edit",
  "expand",
  "remove-bg",
  "edit-text",
  "edit-elements",
  "xiaohongshu-cover",
  "product-marketing-set"
];

function validBrief() {
  return {
    modifications: ["Replace the background with a warm studio setting."],
    preservationRules: ["Keep the product shape and logo unchanged."],
    style: "Warm editorial product photography",
    materials: ["matte paper", "soft fabric"],
    composition: "Centered product with generous title space",
    textRequirements: [],
    outputRequirements: ["One PNG image at the requested aspect ratio."]
  };
}

function validPlannedOutput(overrides = {}) {
  return {
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
    error: null,
    ...overrides
  };
}

function readyPatch(overrides = {}) {
  return {
    recommendedSkillId: "xiaohongshu-cover",
    selectedSkillId: "xiaohongshu-cover",
    structuredBrief: validBrief(),
    optimizedPrompt: "Create a warm editorial 3:4 product cover while preserving the product and logo.",
    plannedOutputs: [validPlannedOutput()],
    ...overrides
  };
}

function initialRun(overrides = {}) {
  return createAgentRun({
    id: "run-001",
    canvasId: "canvas-001",
    sourceObjectIds: ["image-001"],
    rawRequest: "Make a warm product campaign image.",
    ...overrides
  }, { now: "2026-08-29T00:00:00.000Z" });
}

test("stable skill descriptors expose exactly the seven approved ids", () => {
  assert.deepEqual(SKILL_IDS, expectedSkillIds);
  assert.deepEqual(SKILL_DESCRIPTORS.map((descriptor) => descriptor.id), expectedSkillIds);
  for (const descriptor of SKILL_DESCRIPTORS) assert.equal(validateSkillDescriptor(descriptor), descriptor);
  assert.throws(
    () => validateSkillDescriptor({ ...SKILL_DESCRIPTORS[0], id: "custom-skill" }),
    (error) => error.code === "agent-run-validation" && error.message.includes("SkillDescriptor.id")
  );
});

test("AgentRun accepts one to three unique source object ids and rejects other counts", () => {
  assert.deepEqual(Object.keys(initialRun()), [
    "id",
    "canvasId",
    "sourceObjectIds",
    "rawRequest",
    "recommendedSkillId",
    "selectedSkillId",
    "structuredBrief",
    "clarificationQuestions",
    "clarificationAnswers",
    "optimizedPrompt",
    "plannedOutputs",
    "childJobIds",
    "outputObjectIds",
    "status",
    "error",
    "timestamps"
  ]);
  assert.deepEqual(initialRun().sourceObjectIds, ["image-001"]);
  assert.deepEqual(initialRun({ sourceObjectIds: ["one", "two", "three"] }).sourceObjectIds, ["one", "two", "three"]);
  assert.throws(
    () => initialRun({ sourceObjectIds: [] }),
    (error) => error.code === "agent-run-validation" && error.message.includes("sourceObjectIds")
  );
  assert.throws(
    () => initialRun({ sourceObjectIds: ["one", "two", "three", "four"] }),
    (error) => error.code === "agent-run-validation" && error.message.includes("sourceObjectIds")
  );
  assert.throws(
    () => initialRun({ sourceObjectIds: ["duplicate", "duplicate"] }),
    (error) => error.code === "agent-run-validation" && error.message.includes("unique")
  );
});

test("runtime schemas reject malformed nested contracts with a precise field path", () => {
  assert.throws(
    () => validateStructuredBrief({ ...validBrief(), preservationRules: "keep it" }),
    (error) => error.code === "agent-run-validation" && error.message.includes("StructuredBrief.preservationRules")
  );
  const run = initialRun();
  assert.throws(
    () => validateAgentRun({ ...run, recommendedSkillId: "unknown" }),
    (error) => error.code === "agent-run-validation" && error.message.includes("AgentRun.recommendedSkillId")
  );
  assert.throws(
    () => validateAgentRun({ ...run, extraGraph: { nodes: [], edges: [] } }),
    (error) => error.code === "agent-run-validation" && error.message.includes("unknown field")
  );
  assert.throws(
    () => validateAgentRun({ ...run, clarificationAnswers: new Date("2026-08-29T00:00:00.000Z") }),
    (error) => error.code === "agent-run-validation" && error.message.includes("clarificationAnswers")
  );
  assert.throws(
    () => validateAgentRun({ ...run, plannedOutputs: [validPlannedOutput({ format: "psd" })] }),
    (error) => error.code === "agent-run-validation" && error.message.includes("plannedOutputs[0].format")
  );
});

test("state transitions follow the controlled lifecycle and update timestamps", () => {
  const analyzing = initialRun();
  const needsClarification = transitionAgentRun(analyzing, "needs_clarification", {
    clarificationQuestions: [{
      id: "audience",
      prompt: "Who is the intended audience?",
      required: true,
      options: ["Students", "Professionals"]
    }]
  }, { now: "2026-08-29T00:01:00.000Z" });
  const ready = transitionAgentRun(needsClarification, "ready", {
    clarificationAnswers: { audience: "Professionals" },
    ...readyPatch()
  }, { now: "2026-08-29T00:02:00.000Z" });
  const running = transitionAgentRun(ready, "running", {
    childJobIds: ["job-001"],
    plannedOutputs: [validPlannedOutput({ status: "running", jobId: "job-001" })]
  }, { now: "2026-08-29T00:03:00.000Z" });
  const succeeded = transitionAgentRun(running, "succeeded", {
    outputObjectIds: ["image-output-001"],
    plannedOutputs: [validPlannedOutput({
      status: "succeeded",
      jobId: "job-001",
      outputObjectIds: ["image-output-001"]
    })]
  }, { now: "2026-08-29T00:04:00.000Z" });

  assert.equal(succeeded.status, "succeeded");
  assert.deepEqual(succeeded.clarificationAnswers, { audience: "Professionals" });
  assert.deepEqual(succeeded.timestamps, {
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:04:00.000Z",
    statusChangedAt: "2026-08-29T00:04:00.000Z"
  });
  assert.equal(analyzing.status, "analyzing", "transitioning must not mutate the prior snapshot");
});

test("state machine rejects skipped, reversed, and terminal transitions", () => {
  const analyzing = initialRun();
  assert.throws(
    () => transitionAgentRun(analyzing, "running", readyPatch()),
    (error) => error.code === "agent-run-transition" && error.message.includes("analyzing -> running")
  );
  const ready = transitionAgentRun(analyzing, "ready", readyPatch());
  const running = transitionAgentRun(ready, "running");
  const failed = transitionAgentRun(running, "failed", {
    error: { code: "generation-failed", message: "The image job failed.", retryable: true }
  });
  const partial = transitionAgentRun(running, "partial", {
    error: { code: "partial-output", message: "One planned output failed.", retryable: true }
  });
  const cancelled = transitionAgentRun(running, "cancelled");
  assert.equal(partial.status, "partial");
  assert.equal(cancelled.status, "cancelled");
  assert.throws(
    () => transitionAgentRun(failed, "running"),
    (error) => error.code === "agent-run-transition" && error.message.includes("failed -> running")
  );
});

test("state transitions reject timestamps that move backward", () => {
  const ready = transitionAgentRun(initialRun(), "ready", readyPatch(), {
    now: "2026-08-29T00:02:00.000Z"
  });
  assert.throws(
    () => transitionAgentRun(ready, "running", {}, { now: "2026-08-29T00:01:00.000Z" }),
    (error) => error.code === "agent-run-validation" && error.message.includes("updatedAt")
  );
});

test("AgentRun storage writes the exact thread path and reports missing or corrupt data clearly", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-run-errors-"));
  const run = initialRun();
  const written = await writeAgentRun(projectDir, run);
  const runPath = path.join(projectDir, "canvas", "threads", "canvas-001", "runs", "run-001", "run.json");

  assert.equal(agentRunPathFor(projectDir, run.canvasId, run.id), runPath);
  assert.deepEqual(JSON.parse(await fs.readFile(runPath, "utf8")), written);
  await assert.rejects(
    () => readAgentRun(projectDir, { canvasId: run.canvasId, agentRunId: "missing-run" }),
    (error) => error.code === "agent-run-not-found" && error.statusCode === 404 && error.message.includes("missing-run")
  );

  await fs.writeFile(runPath, "{ definitely not json\n");
  await assert.rejects(
    () => readAgentRun(projectDir, { canvasId: run.canvasId, agentRunId: run.id }),
    (error) => error.code === "agent-run-corrupt" && error.message.includes("run.json") && error.cause instanceof Error
  );
});

test("atomic writes never expose partial JSON and leave no temporary files", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-run-atomic-"));
  const run = initialRun();
  await writeAgentRun(projectDir, run);
  const runPath = agentRunPathFor(projectDir, run.canvasId, run.id);
  let writing = true;
  let reads = 0;
  const reader = (async () => {
    while (writing) {
      const parsed = JSON.parse(await fs.readFile(runPath, "utf8"));
      validateAgentRun(parsed);
      reads += 1;
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();

  try {
    await Promise.all(Array.from({ length: 40 }, (_, index) => writeAgentRun(projectDir, {
      ...run,
      rawRequest: `${index}-${"x".repeat(16_000)}`,
      timestamps: {
        ...run.timestamps,
        updatedAt: new Date(Date.parse(run.timestamps.updatedAt) + index + 1).toISOString()
      }
    })));
  } finally {
    writing = false;
    await reader;
  }

  assert.ok(reads > 0);
  const entries = await fs.readdir(path.dirname(runPath));
  assert.deepEqual(entries, ["run.json"]);
});

test("per-run cross-process locking preserves concurrent updates while separate runs stay isolated", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-run-lock-"));
  const first = initialRun({ id: "run-first" });
  const second = initialRun({ id: "run-second", sourceObjectIds: ["image-002"], rawRequest: "Second request" });
  await Promise.all([writeAgentRun(projectDir, first), writeAgentRun(projectDir, second)]);
  assert.equal((await readAgentRun(projectDir, { canvasId: first.canvasId, agentRunId: first.id })).rawRequest, first.rawRequest);
  assert.equal((await readAgentRun(projectDir, { canvasId: second.canvasId, agentRunId: second.id })).rawRequest, second.rawRequest);

  const startPath = path.join(projectDir, "start-workers");
  const workers = [
    startWorker([projectDir, first.canvasId, first.id, startPath, "left", "one"]),
    startWorker([projectDir, first.canvasId, first.id, startPath, "right", "two"])
  ];
  await fs.writeFile(startPath, "go\n");
  await Promise.all(workers);
  const updated = await readAgentRun(projectDir, { canvasId: first.canvasId, agentRunId: first.id });
  assert.deepEqual(updated.clarificationAnswers, { left: "one", right: "two" });
});

test("a fresh module instance restores a persisted run after restart", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-run-restart-"));
  const ready = transitionAgentRun(initialRun(), "ready", readyPatch());
  const running = transitionAgentRun(ready, "running", { childJobIds: ["job-recover"] });
  await writeAgentRun(projectDir, running);

  const restartedStore = await import(`../src/agent-run-store.mjs?restart=${Date.now()}`);
  const restored = await restartedStore.readAgentRun(projectDir, {
    canvasId: running.canvasId,
    agentRunId: running.id
  });
  assert.equal(restored.status, "running");
  assert.deepEqual(restored.childJobIds, ["job-recover"]);
});

test("AgentRun storage leaves a legacy codex-canvas.json readable and unchanged", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-run-legacy-"));
  const legacyPath = statePathFor(projectDir);
  const legacy = {
    version: 1,
    title: "Legacy canvas",
    viewport: { x: 3, y: 4, zoom: 0.72 },
    objects: [{ id: "legacy-text", type: "text", text: "Still readable", x: 1, y: 2, width: 100, height: 40 }],
    selection: "legacy-text",
    updatedAt: "2026-08-28T00:00:00.000Z"
  };
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`);
  const before = await fs.readFile(legacyPath, "utf8");

  await writeAgentRun(projectDir, initialRun());
  const state = await readState(projectDir);
  assert.equal(state.title, "Legacy canvas");
  assert.equal(state.objects[0].text, "Still readable");
  assert.equal(await fs.readFile(legacyPath, "utf8"), before);
});

test("canvas image provenance persists only lightweight AgentRun source fields", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-run-provenance-"));
  const existingShape = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "existing-shape.png",
    allowDuplicate: true
  });
  assert.equal(existingShape.batchId, null, "ordinary images must retain the existing batchId null shape");

  const image = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "derived.png",
    agentRunId: "run-001",
    sourceObjectIds: ["source-1", "source-2", "source-3"],
    parentVersionId: "version-001",
    batchId: "batch-001",
    jobId: "job-001",
    nodes: [{ id: "forbidden-node" }],
    edges: [{ from: "source-1", to: "forbidden-node" }],
    dag: { root: "forbidden-node" }
  });
  const restored = (await readState(projectDir)).objects.find((object) => object.id === image.id);

  assert.deepEqual({
    agentRunId: restored.agentRunId,
    sourceObjectIds: restored.sourceObjectIds,
    parentVersionId: restored.parentVersionId,
    batchId: restored.batchId,
    jobId: restored.jobId
  }, {
    agentRunId: "run-001",
    sourceObjectIds: ["source-1", "source-2", "source-3"],
    parentVersionId: "version-001",
    batchId: "batch-001",
    jobId: "job-001"
  });
  assert.equal(Object.hasOwn(restored, "nodes"), false);
  assert.equal(Object.hasOwn(restored, "edges"), false);
  assert.equal(Object.hasOwn(restored, "dag"), false);
});

function startWorker(args) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(process.cwd(), "test", "fixtures", "agent-run-store-worker.mjs");
    const child = spawn(process.execPath, [workerPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`AgentRun worker timed out: ${stderr || stdout}`));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`AgentRun worker exited with ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)));
      } catch (error) {
        reject(new Error(`AgentRun worker returned invalid JSON: ${stdout || stderr}`, { cause: error }));
      }
    });
  });
}
