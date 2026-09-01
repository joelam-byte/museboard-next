import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeAgentRun,
  answerAgentRunClarifications,
  selectAgentRunSkill
} from "../src/agent-brief-service.mjs";
import { readAgentRun, updateAgentRun } from "../src/agent-run-store.mjs";
import { assetsDirFor, jobsDirFor, statePathFor } from "../src/paths.mjs";
import { addImage, addObject } from "../src/store.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const expectedSkillIds = [
  "generate-image",
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
    outputRequirements: ["One PNG image at 1080 by 1440 pixels."]
  };
}

function validPlannedOutput(overrides = {}) {
  return {
    id: "cover",
    label: "Xiaohongshu cover",
    purpose: "A finished Chinese social cover with title, layout, and preserved source elements.",
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

function validCandidate(overrides = {}) {
  return {
    recommendedSkillId: "xiaohongshu-cover",
    structuredBrief: validBrief(),
    clarificationQuestions: [],
    optimizedPrompt: "Create a warm editorial 3:4 product cover while preserving the product and logo.",
    plannedOutputs: [validPlannedOutput()],
    ...overrides
  };
}

test("analysis adapter receives complete ordered image and request context for one to three sources", async (t) => {
  for (const sourceCount of [1, 2, 3]) {
    await t.test(`${sourceCount} source image${sourceCount === 1 ? "" : "s"}`, async () => {
      const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), `museboard-agent-brief-${sourceCount}-`));
      const canvasId = `canvas-${sourceCount}`;
      const sources = [];
      for (let index = 0; index < sourceCount; index += 1) {
        sources.push(await addImage(projectDir, {
          dataUrl: `data:image/png;base64,${pngOne}`,
          name: `source-${index + 1}.png`,
          prompt: `Original source ${index + 1}`,
          allowDuplicate: true
        }, { canvasId }));
      }

      let receivedContext;
      const run = await analyzeAgentRun(projectDir, {
        id: `run-${sourceCount}`,
        canvasId,
        sourceObjectIds: sources.map((source) => source.id),
        rawRequest: "Turn these sources into a warm product campaign cover."
      }, {
        analyze: async (context) => {
          receivedContext = context;
          return validCandidate();
        }
      });

      assert.deepEqual(receivedContext.request, {
        agentRunId: `run-${sourceCount}`,
        canvasId,
        rawRequest: "Turn these sources into a warm product campaign cover.",
        sourceObjectIds: sources.map((source) => source.id),
        clarificationAnswers: {}
      });
      assert.deepEqual(receivedContext.sources.map((source) => source.objectId), sources.map((source) => source.id));
      assert.deepEqual(receivedContext.allowedSkillIds, expectedSkillIds);
      assert.deepEqual(receivedContext.skillDescriptors.map((descriptor) => descriptor.id), expectedSkillIds);
      for (const [index, source] of receivedContext.sources.entries()) {
        assert.equal(source.name, `source-${index + 1}.png`);
        assert.equal(source.mimeType, "image/png");
        assert.equal(source.dataUrl, `data:image/png;base64,${pngOne}`);
        assert.equal(source.url, null);
        assert.equal(source.naturalWidth, 1);
        assert.equal(source.naturalHeight, 1);
        assert.equal(source.prompt, `Original source ${index + 1}`);
      }
      assert.equal(run.status, "ready");
      assert.deepEqual(run.structuredBrief, validBrief());
      assert.deepEqual(run.plannedOutputs, [validPlannedOutput()]);
      assert.equal(run.recommendedSkillId, "xiaohongshu-cover");
      assert.equal(run.selectedSkillId, "xiaohongshu-cover");
      assert.equal(run.optimizedPrompt, validCandidate().optimizedPrompt);
      assert.deepEqual(run.childJobIds, []);
      assert.deepEqual(run.outputObjectIds, []);
      assert.deepEqual(await readAgentRun(projectDir, { canvasId, agentRunId: run.id }), run);
      await assert.rejects(fs.access(jobsDirFor(projectDir, canvasId)), (error) => error.code === "ENOENT");
    });
  }
});

test("only result-significant clarification questions block a run from becoming ready", async () => {
  const cases = [
    {
      label: "result-significant",
      question: {
        id: "replacement-copy",
        prompt: "What exact replacement copy must appear in the image?",
        required: true,
        options: []
      },
      expectedStatus: "needs_clarification"
    },
    {
      label: "non-blocking preference",
      question: {
        id: "accent-preference",
        prompt: "Would you prefer a peach or coral accent?",
        required: false,
        options: ["Peach", "Coral"]
      },
      expectedStatus: "ready"
    }
  ];

  for (const testCase of cases) {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), `museboard-agent-clarification-${testCase.label}-`));
    const canvasId = `canvas-${testCase.label}`;
    const source = await addImage(projectDir, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: "source.png",
      allowDuplicate: true
    }, { canvasId });

    const run = await analyzeAgentRun(projectDir, {
      id: `run-${testCase.label}`,
      canvasId,
      sourceObjectIds: [source.id],
      rawRequest: "Replace the headline and keep the existing layout."
    }, {
      analyze: async () => validCandidate({ clarificationQuestions: [testCase.question] })
    });

    assert.equal(run.status, testCase.expectedStatus);
    assert.deepEqual(run.clarificationQuestions, [testCase.question]);
    assert.deepEqual(run.childJobIds, []);
    assert.deepEqual(run.outputObjectIds, []);
  }
});

test("an invalid recommended Skill is accepted only after exactly one schema repair", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-repair-success-"));
  const canvasId = "canvas-repair-success";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  let repairCalls = 0;

  const run = await analyzeAgentRun(projectDir, {
    id: "run-repair-success",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Create a product cover with a stable supported workflow."
  }, {
    analyze: async () => validCandidate({ recommendedSkillId: "made-up-skill" }),
    repair: async ({ candidate, validationError, context }) => {
      repairCalls += 1;
      assert.equal(candidate.recommendedSkillId, "made-up-skill");
      assert.equal(validationError.code, "agent-run-validation");
      assert.equal(context.request.agentRunId, "run-repair-success");
      return validCandidate({ recommendedSkillId: "xiaohongshu-cover" });
    }
  });

  assert.equal(repairCalls, 1);
  assert.equal(run.recommendedSkillId, "xiaohongshu-cover");
  assert.equal(run.selectedSkillId, "xiaohongshu-cover");
  assert.equal(run.status, "ready");
});

test("the injected analyzer performs exactly one structured schema repair when no repair override is provided", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-repair-default-"));
  const canvasId = "canvas-repair-default";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const invocations = [];

  const run = await analyzeAgentRun(projectDir, {
    id: "run-repair-default",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Use the supported routing contract for this background edit."
  }, {
    analyze: async (context, invocation = { mode: "analyze" }) => {
      invocations.push(invocation);
      if (invocation.mode === "schema-repair") {
        assert.equal(context.request.agentRunId, "run-repair-default");
        assert.equal(invocation.candidate.recommendedSkillId, "not-supported");
        assert.equal(invocation.validationError.code, "agent-run-validation");
        return validCandidate({ recommendedSkillId: "remove-bg" });
      }
      return validCandidate({ recommendedSkillId: "not-supported" });
    }
  });

  assert.deepEqual(invocations.map((invocation) => invocation.mode), ["analyze", "schema-repair"]);
  assert.equal(run.recommendedSkillId, "remove-bg");
  assert.equal(run.status, "ready");
});

test("a second schema failure throws clearly and leaves the persisted run ungenerated", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-repair-failure-"));
  const canvasId = "canvas-repair-failure";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  let repairCalls = 0;

  await assert.rejects(
    () => analyzeAgentRun(projectDir, {
      id: "run-repair-failure",
      canvasId,
      sourceObjectIds: [source.id],
      rawRequest: "Create a cover without triggering any generation yet."
    }, {
      analyze: async () => ({ ...validCandidate(), unexpectedGraph: { nodes: [], edges: [] } }),
      repair: async () => {
        repairCalls += 1;
        return validCandidate({
          plannedOutputs: [validPlannedOutput({ status: "queued", jobId: "job-forbidden" })]
        });
      }
    }),
    (error) => (
      error.code === "agent-brief-schema-invalid"
      && error.statusCode === 422
      && error.message.includes("one schema-repair attempt")
      && error.cause?.code === "agent-run-validation"
    )
  );

  assert.equal(repairCalls, 1);
  const stored = await readAgentRun(projectDir, {
    canvasId,
    agentRunId: "run-repair-failure"
  });
  assert.equal(stored.status, "analyzing");
  assert.equal(stored.structuredBrief, null);
  assert.deepEqual(stored.plannedOutputs, []);
  assert.deepEqual(stored.childJobIds, []);
  assert.deepEqual(stored.outputObjectIds, []);
  await assert.rejects(fs.access(jobsDirFor(projectDir, canvasId)), (error) => error.code === "ENOENT");
});

test("all significant clarifications must be answered before ready and answers are persisted", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-clarification-answer-"));
  const canvasId = "canvas-clarification-answer";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const questions = [
    {
      id: "replacement-copy",
      prompt: "What exact replacement copy must appear?",
      required: true,
      options: []
    },
    {
      id: "accent-preference",
      prompt: "Which optional accent do you prefer?",
      required: false,
      options: ["Peach", "Coral"]
    }
  ];
  await analyzeAgentRun(projectDir, {
    id: "run-clarification-answer",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Replace the headline without changing the layout."
  }, {
    analyze: async () => validCandidate({ clarificationQuestions: questions })
  });
  let finalAnalysisCalls = 0;

  await assert.rejects(
    () => answerAgentRunClarifications(projectDir, {
      canvasId,
      agentRunId: "run-clarification-answer",
      answers: { "accent-preference": "Peach" }
    }),
    (error) => error.code === "agent-brief-clarification-required" && error.missingQuestionIds[0] === "replacement-copy"
  );
  assert.equal((await readAgentRun(projectDir, {
    canvasId,
    agentRunId: "run-clarification-answer"
  })).status, "needs_clarification");

  const finalPrompt = "Replace the headline with 'Better mornings start here'; preserve the layout and use a peach accent.";
  const ready = await answerAgentRunClarifications(projectDir, {
    canvasId,
    agentRunId: "run-clarification-answer",
    answers: {
      "replacement-copy": "Better mornings start here",
      "accent-preference": "Peach"
    }
  }, {
    analyze: async (context) => {
      finalAnalysisCalls += 1;
      assert.deepEqual(context.request.clarificationAnswers, {
        "replacement-copy": "Better mornings start here",
        "accent-preference": "Peach"
      });
      return validCandidate({ optimizedPrompt: finalPrompt });
    }
  });
  assert.equal(finalAnalysisCalls, 1);
  assert.equal(ready.status, "ready");
  assert.equal(ready.optimizedPrompt, finalPrompt);
  assert.deepEqual(ready.clarificationAnswers, {
    "replacement-copy": "Better mornings start here",
    "accent-preference": "Peach"
  });
  assert.deepEqual(await readAgentRun(projectDir, { canvasId, agentRunId: ready.id }), ready);
});

test("clarification reanalysis remains blocked when it discovers another significant question", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-clarification-iterative-"));
  const canvasId = "canvas-clarification-iterative";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  await analyzeAgentRun(projectDir, {
    id: "run-clarification-iterative",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Create a campaign image for a specific market and format."
  }, {
    analyze: async () => validCandidate({
      clarificationQuestions: [{
        id: "market",
        prompt: "Which market is this for?",
        required: true,
        options: ["Singapore", "Japan"]
      }]
    })
  });
  const nextQuestion = {
    id: "legal-copy",
    prompt: "What exact required legal copy must appear?",
    required: true,
    options: []
  };

  const stillBlocked = await answerAgentRunClarifications(projectDir, {
    canvasId,
    agentRunId: "run-clarification-iterative",
    answers: { market: "Singapore" }
  }, {
    analyze: async () => validCandidate({ clarificationQuestions: [nextQuestion] })
  });

  assert.equal(stillBlocked.status, "needs_clarification");
  assert.deepEqual(stillBlocked.clarificationQuestions, [nextQuestion]);
  assert.deepEqual(stillBlocked.clarificationAnswers, { market: "Singapore" });
  assert.deepEqual(stillBlocked.childJobIds, []);
});

test("a user can replace the selected stable Skill and optimized prompt before confirmation", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-select-skill-"));
  const canvasId = "canvas-select-skill";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const analyzed = await analyzeAgentRun(projectDir, {
    id: "run-select-skill",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Prepare a clean background edit while keeping the product unchanged."
  }, {
    analyze: async () => validCandidate()
  });
  assert.equal(analyzed.selectedSkillId, "xiaohongshu-cover");

  const optimizedPrompt = "Remove only the background; preserve every foreground pixel and export one transparent PNG.";
  const selected = await selectAgentRunSkill(projectDir, {
    canvasId,
    agentRunId: analyzed.id,
    selectedSkillId: "remove-bg",
    optimizedPrompt
  });
  assert.equal(selected.recommendedSkillId, "xiaohongshu-cover");
  assert.equal(selected.selectedSkillId, "remove-bg");
  assert.equal(selected.optimizedPrompt, optimizedPrompt);
  assert.deepEqual(await readAgentRun(projectDir, { canvasId, agentRunId: analyzed.id }), selected);

  await assert.rejects(
    () => selectAgentRunSkill(projectDir, {
      canvasId,
      agentRunId: analyzed.id,
      selectedSkillId: "custom-unapproved-skill",
      optimizedPrompt: "This invalid selection must never persist."
    }),
    (error) => error.code === "agent-run-validation" && error.message.includes("selectedSkillId")
  );
  const unchanged = await readAgentRun(projectDir, { canvasId, agentRunId: analyzed.id });
  assert.equal(unchanged.selectedSkillId, "remove-bg");
  assert.equal(unchanged.optimizedPrompt, optimizedPrompt);
});

test("a duplicate analysis id is rejected without overwriting its existing AgentRun", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-duplicate-run-"));
  const canvasId = "canvas-duplicate-run";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const initial = await analyzeAgentRun(projectDir, {
    id: "run-duplicate",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Replace the existing headline while preserving the product image."
  }, {
    analyze: async () => validCandidate({
      clarificationQuestions: [{
        id: "headline",
        prompt: "What exact replacement headline should appear?",
        required: true,
        options: []
      }]
    })
  });
  let secondAnalyzerCalls = 0;

  await assert.rejects(
    () => analyzeAgentRun(projectDir, {
      id: initial.id,
      canvasId,
      sourceObjectIds: [source.id],
      rawRequest: "This second request must not replace the original run."
    }, {
      analyze: async () => {
        secondAnalyzerCalls += 1;
        return validCandidate();
      }
    }),
    (error) => error.code === "agent-run-already-exists" && error.statusCode === 409
  );

  assert.equal(secondAnalyzerCalls, 0);
  assert.deepEqual(await readAgentRun(projectDir, {
    canvasId,
    agentRunId: initial.id
  }), initial);
});

test("reanalysis treats a repeated required question with a stored answer as non-blocking", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-repeated-question-"));
  const canvasId = "canvas-repeated-question";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const question = {
    id: "headline",
    prompt: "What exact replacement headline should appear?",
    required: true,
    options: []
  };
  await analyzeAgentRun(projectDir, {
    id: "run-repeated-question",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Replace the existing headline while preserving the product image."
  }, {
    analyze: async () => validCandidate({ clarificationQuestions: [question] })
  });

  const ready = await answerAgentRunClarifications(projectDir, {
    canvasId,
    agentRunId: "run-repeated-question",
    answers: { headline: "Better mornings start here" }
  }, {
    analyze: async () => validCandidate({ clarificationQuestions: [question] })
  });

  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.clarificationAnswers, { headline: "Better mornings start here" });
});

test("clarification answers reject unknown and duplicate question ids without changing the run", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-answer-ids-"));
  const canvasId = "canvas-answer-ids";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const questions = [
    {
      id: "market",
      prompt: "Which market is this campaign for?",
      required: true,
      options: ["Singapore", "Japan"]
    },
    {
      id: "legal-copy",
      prompt: "What required legal copy must appear?",
      required: true,
      options: []
    }
  ];
  await analyzeAgentRun(projectDir, {
    id: "run-answer-ids",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Create a compliant campaign image for the intended market."
  }, {
    analyze: async () => validCandidate({ clarificationQuestions: questions })
  });

  await assert.rejects(
    () => answerAgentRunClarifications(projectDir, {
      canvasId,
      agentRunId: "run-answer-ids",
      answers: { "obsolete-question": "This question is not active." }
    }),
    (error) => error.code === "agent-brief-clarification-answer-invalid" && error.questionIds[0] === "obsolete-question"
  );

  await updateAgentRun(projectDir, {
    canvasId,
    agentRunId: "run-answer-ids"
  }, (current) => ({
    ...current,
    clarificationAnswers: { market: "Singapore" }
  }));
  const beforeDuplicate = await readAgentRun(projectDir, {
    canvasId,
    agentRunId: "run-answer-ids"
  });

  await assert.rejects(
    () => answerAgentRunClarifications(projectDir, {
      canvasId,
      agentRunId: "run-answer-ids",
      answers: {
        market: "Japan",
        "legal-copy": "For illustrative purposes only."
      }
    }),
    (error) => error.code === "agent-brief-clarification-answer-invalid" && error.questionIds[0] === "market"
  );
  assert.deepEqual(await readAgentRun(projectDir, {
    canvasId,
    agentRunId: "run-answer-ids"
  }), beforeDuplicate);
});

test("AgentRun routing rejects incompatible source and planned-output counts before persisting", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-skill-counts-"));
  const canvasId = "canvas-skill-counts";
  const sources = [];
  for (let index = 0; index < 3; index += 1) {
    sources.push(await addImage(projectDir, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: `source-${index}.png`,
      allowDuplicate: true
    }, { canvasId }));
  }
  let repairs = 0;
  const repaired = await analyzeAgentRun(projectDir, {
    id: "run-incompatible-source-count",
    canvasId,
    sourceObjectIds: sources.map((source) => source.id),
    rawRequest: "Create a coordinated campaign from all three product references."
  }, {
    analyze: async () => validCandidate({ recommendedSkillId: "remove-bg" }),
    repair: async () => {
      repairs += 1;
      return validCandidate({
        recommendedSkillId: "product-marketing-set",
        plannedOutputs: [
          validPlannedOutput({ id: "main", label: "Main image", purpose: "Primary listing image", width: 1080, height: 1350, aspectRatio: "4:5" }),
          validPlannedOutput({ id: "benefit", label: "Benefit image", purpose: "Key benefit image", width: 1080, height: 1350, aspectRatio: "4:5" }),
          validPlannedOutput({ id: "scene", label: "Scene image", purpose: "Lifestyle scene image", width: 1080, height: 1350, aspectRatio: "4:5" }),
          validPlannedOutput({ id: "detail", label: "Detail image", purpose: "Product detail image", width: 1080, height: 1350, aspectRatio: "4:5" })
        ]
      });
    }
  });
  assert.equal(repairs, 1);
  assert.equal(repaired.selectedSkillId, "product-marketing-set");
  assert.equal(repaired.plannedOutputs.length, 4);

  await assert.rejects(
    () => selectAgentRunSkill(projectDir, {
      canvasId,
      agentRunId: repaired.id,
      selectedSkillId: "quick-edit",
      optimizedPrompt: "Apply a local edit to all selected references."
    }),
    (error) => error.code === "agent-run-validation" && error.message.includes("selectedSkillId")
  );
});

test("analysis rejects unsupported source assets and symbolic links inside the canvas asset directory", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-source-path-"));
  const canvasId = "canvas-source-path";
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const statePath = statePathFor(projectDir, canvasId);
  const setSourceAssetPath = async (assetPath) => {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    state.objects.find((object) => object.id === source.id).assetPath = assetPath;
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };
  const expectRejectedSource = async (id) => {
    let analyzerCalls = 0;
    await assert.rejects(
      () => analyzeAgentRun(projectDir, {
        id,
        canvasId,
        sourceObjectIds: [source.id],
        rawRequest: "Analyze this source without exposing files outside this canvas."
      }, {
        analyze: async () => {
          analyzerCalls += 1;
          return validCandidate();
        }
      }),
      (error) => error.code === "agent-brief-source-asset-invalid" && error.statusCode === 400
    );
    assert.equal(analyzerCalls, 0);
  };

  const assetsDir = assetsDirFor(projectDir, canvasId);
  const unsupportedAsset = path.join(assetsDir, "unsupported-source.txt");
  await fs.writeFile(unsupportedAsset, "not an image");
  await setSourceAssetPath(unsupportedAsset);
  await expectRejectedSource("run-unsupported-asset");

  const outsideAsset = path.join(projectDir, "outside.txt");
  await fs.writeFile(outsideAsset, "do not disclose");
  const linkPath = path.join(assetsDir, "linked-source.png");
  try {
    await fs.symlink(outsideAsset, linkPath, "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      return;
    }
    throw error;
  }
  await setSourceAssetPath(linkPath);
  await expectRejectedSource("run-linked-asset");
});

test("analysis preserves GIF and AVIF canvas source assets", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-modern-images-"));
  const canvasId = "canvas-modern-images";
  const formats = [
    {
      extension: "gif",
      mimeType: "image/gif",
      data: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
    },
    {
      extension: "avif",
      mimeType: "image/avif",
      data: Buffer.from("\x00\x00\x00\x18ftypavif\x00\x00\x00\x00avif", "binary").toString("base64")
    }
  ];

  for (const format of formats) {
    const source = await addImage(projectDir, {
      dataUrl: `data:${format.mimeType};base64,${format.data}`,
      name: `source.${format.extension}`,
      allowDuplicate: true
    }, { canvasId });
    let receivedContext;
    const run = await analyzeAgentRun(projectDir, {
      id: `run-${format.extension}`,
      canvasId,
      sourceObjectIds: [source.id],
      rawRequest: `Analyze this ${format.extension.toUpperCase()} product reference without generation.`
    }, {
      analyze: async (context) => {
        receivedContext = context;
        return validCandidate();
      }
    });
    assert.equal(run.status, "ready");
    assert.equal(receivedContext.sources[0].mimeType, format.mimeType);
    assert.equal(receivedContext.sources[0].dataUrl, `data:${format.mimeType};base64,${format.data}`);
  }
});
+test("selecting a business Skill replaces an incompatible plan with its fixed output slots", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-business-selection-"));
  const canvasId = "canvas-business-selection";
  const source = await addImage(projectDir, {
    dataUrl: "data:image/png;base64," + pngOne,
    name: "source.png",
    allowDuplicate: true
  }, { canvasId });
  const run = await analyzeAgentRun(projectDir, {
    id: "run-business-selection",
    canvasId,
    sourceObjectIds: [source.id],
    rawRequest: "Create a complete product marketing set from this image."
  }, {
    analyze: async () => validCandidate({ recommendedSkillId: "quick-edit" })
  });

  const selected = await selectAgentRunSkill(projectDir, {
    canvasId,
    agentRunId: run.id,
    selectedSkillId: "product-marketing-set",
    optimizedPrompt: "Create a marketplace-ready product set."
  });

  assert.equal(selected.selectedSkillId, "product-marketing-set");
  assert.deepEqual(selected.plannedOutputs.map((output) => output.id), ["main", "benefit", "scene", "detail"]);
  assert.deepEqual(selected.plannedOutputs.map((output) => output.aspectRatio), ["4:5", "4:5", "4:5", "4:5"]);
});

test("analysis accepts only image objects with a usable local asset or HTTP image URL", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "museboard-agent-source-boundary-"));
  const canvasId = "canvas-source-boundary";
  const remoteImage = await addImage(projectDir, {
    url: "https://images.example.test/product.png",
    name: "remote-product.png",
    allowDuplicate: true
  }, { canvasId });
  let remoteContext;
  await analyzeAgentRun(projectDir, {
    id: "run-remote-image",
    canvasId,
    sourceObjectIds: [remoteImage.id],
    rawRequest: "Analyze the remote product image without starting a generation."
  }, {
    analyze: async (context) => {
      remoteContext = context;
      return validCandidate();
    }
  });
  assert.equal(remoteContext.sources[0].dataUrl, null);
  assert.equal(remoteContext.sources[0].url, "https://images.example.test/product.png");

  const text = await addObject(projectDir, {
    type: "text",
    text: "This is not an image."
  }, { canvasId });
  const assertRejectedBeforeAnalysis = async (id, sourceObjectId) => {
    let analyzerCalls = 0;
    await assert.rejects(
      () => analyzeAgentRun(projectDir, {
        id,
        canvasId,
        sourceObjectIds: [sourceObjectId],
        rawRequest: "Reject invalid sources before sending anything to analysis."
      }, {
        analyze: async () => {
          analyzerCalls += 1;
          return validCandidate();
        }
      }),
      (error) => error.code === "agent-brief-source-asset-invalid" && error.statusCode === 400
    );
    assert.equal(analyzerCalls, 0);
  };
  await assertRejectedBeforeAnalysis("run-text-source", text.id);

  const statePath = statePathFor(projectDir, canvasId);
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  state.objects.find((object) => object.id === remoteImage.id).src = "file:///private/source.png";
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await assertRejectedBeforeAnalysis("run-invalid-remote-source", remoteImage.id);
});
