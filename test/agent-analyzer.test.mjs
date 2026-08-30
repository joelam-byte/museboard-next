import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexAgentAnalyzer } from "../src/agent-analyzer.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const candidate = {
  recommendedSkillId: "quick-edit",
  structuredBrief: {
    modifications: ["Replace the background."],
    preservationRules: ["Keep the product logo."],
    style: "Warm product photography",
    materials: [],
    composition: "Centered product",
    textRequirements: [],
    outputRequirements: ["One PNG image."]
  },
  clarificationQuestions: [],
  optimizedPrompt: "Create a warm product image and keep the logo.",
  plannedOutputs: [{
    id: "output-main",
    label: "Main image",
    purpose: "Campaign image",
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

test("Codex analyzer writes local source images and returns its JSON candidate", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-analyzer-"));
  let received;
  const analyze = createCodexAgentAnalyzer({
    runCodex: async (request) => {
      received = request;
      await fs.mkdir(path.dirname(request.outputPath), { recursive: true });
      await fs.writeFile(request.outputPath, JSON.stringify(candidate));
    }
  });

  const result = await analyze({
    request: {
      agentRunId: "agent-run-1",
      canvasId: "shared",
      rawRequest: "Make this a warm campaign visual while preserving the logo.",
      sourceObjectIds: ["source-1"],
      clarificationAnswers: {}
    },
    sources: [{
      objectId: "source-1",
      name: "source.png",
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${pngOne}`,
      url: null,
      naturalWidth: 1,
      naturalHeight: 1,
      displayWidth: 1,
      displayHeight: 1,
      prompt: "Original source",
      imagegenPrompt: ""
    }],
    allowedSkillIds: ["quick-edit"],
    skillDescriptors: [{
      id: "quick-edit",
      name: "Quick Edit",
      description: "Edit a source image.",
      sourceImageCount: { min: 1, max: 1 },
      outputCount: { min: 1, max: 1 },
      requiresConfirmation: true
    }]
  });

  assert.deepEqual(result, candidate);
  assert.equal(received.imagePaths.length, 1);
  assert.equal(path.extname(received.imagePaths[0]), ".png");
  assert.equal((await fs.readFile(received.imagePaths[0])).toString("base64"), pngOne);
  assert.equal(received.outputPath.endsWith(path.join("runs", "agent-run-1", "analysis", "brief.json")), true);
  assert.match(received.prompt, /Make this a warm campaign visual/);
  assert.match(received.prompt, /quick-edit/);
});
