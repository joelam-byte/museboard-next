import assert from "node:assert/strict";
import test from "node:test";
import { buildBusinessSkillJobPlan, normalizeBusinessSkillInputs } from "../src/business-skill-recipes.mjs";
import { SKILL_DESCRIPTORS } from "../src/agent-run-contracts.mjs";

function plannedOutputsFor(skillId) {
  const descriptor = SKILL_DESCRIPTORS.find((candidate) => candidate.id === skillId);
  return descriptor.outputSpecs.map((spec) => ({
    ...spec,
    status: "planned",
    jobId: null,
    outputObjectIds: [],
    error: null
  }));
}

test("Xiaohongshu Cover turns validated brief fields into one server-owned job recipe", () => {
  const skillInputs = normalizeBusinessSkillInputs("xiaohongshu-cover", {
    "content-type": "Product recommendation",
    headline: "一杯喝懂秋日拿铁",
    "headline-style": "Friendly handwritten",
    "headline-position": "Top",
    "preserve-elements": "保留杯身 logo 与奶泡纹理"
  });

  const jobs = buildBusinessSkillJobPlan({
    skillId: "xiaohongshu-cover",
    sourceObjectIds: ["source-a", "source-b"],
    optimizedPrompt: "Create a warm, credible product recommendation cover.",
    skillInputs,
    plannedOutputs: plannedOutputsFor("xiaohongshu-cover"),
    jobIds: ["job-cover"]
  });

  assert.deepEqual(jobs.map((job) => ({
    id: job.id,
    action: job.action,
    outputId: job.outputId,
    sourceObjectIds: job.sourceObjectIds,
    width: job.output.width,
    height: job.output.height,
    aspectRatio: job.output.aspectRatio
  })), [{
    id: "job-cover",
    action: "xiaohongshu-cover",
    outputId: "cover",
    sourceObjectIds: ["source-a", "source-b"],
    width: 1080,
    height: 1440,
    aspectRatio: "3:4"
  }]);
  assert.match(jobs[0].prompt, /一杯喝懂秋日拿铁/u);
  assert.match(jobs[0].prompt, /保留杯身 logo 与奶泡纹理/u);
  assert.match(jobs[0].prompt, /1080 × 1440/u);
});

test("Product Marketing Set creates four independent fixed output recipes", () => {
  const skillInputs = normalizeBusinessSkillInputs("product-marketing-set", {
    "sales-channel": "Marketplace listing",
    "primary-benefit": "Double-wall insulation keeps drinks warm for longer.",
    "target-audience": "Commuters who want a durable everyday tumbler.",
    "visual-style": "Clean studio",
    "preserve-elements": "Keep the logo, lid shape, and matte steel texture."
  });

  const jobs = buildBusinessSkillJobPlan({
    skillId: "product-marketing-set",
    sourceObjectIds: ["source-product"],
    optimizedPrompt: "Create a practical, premium marketing set with accurate product details.",
    skillInputs,
    plannedOutputs: plannedOutputsFor("product-marketing-set"),
    jobIds: ["job-main", "job-benefit", "job-scene", "job-detail"]
  });

  assert.deepEqual(jobs.map((job) => ({
    id: job.id,
    outputId: job.outputId,
    action: job.action,
    aspectRatio: job.output.aspectRatio
  })), [
    { id: "job-main", outputId: "main", action: "product-marketing-set", aspectRatio: "4:5" },
    { id: "job-benefit", outputId: "benefit", action: "product-marketing-set", aspectRatio: "4:5" },
    { id: "job-scene", outputId: "scene", action: "product-marketing-set", aspectRatio: "4:5" },
    { id: "job-detail", outputId: "detail", action: "product-marketing-set", aspectRatio: "4:5" }
  ]);
  assert.match(jobs.find((job) => job.outputId === "main").prompt, /primary listing image/i);
  assert.match(jobs.find((job) => job.outputId === "benefit").prompt, /Double-wall insulation/u);
  assert.match(jobs.find((job) => job.outputId === "scene").prompt, /Commuters/u);
  assert.match(jobs.find((job) => job.outputId === "detail").prompt, /matte steel texture/u);
  const retryJobs = buildBusinessSkillJobPlan({
    skillId: "product-marketing-set",
    sourceObjectIds: ["source-product"],
    optimizedPrompt: "Create a practical, premium marketing set with accurate product details.",
    skillInputs,
    plannedOutputs: plannedOutputsFor("product-marketing-set"),
    outputIds: ["benefit"],
    jobIds: ["job-benefit-retry"]
  });
  assert.deepEqual(retryJobs.map((job) => [job.id, job.outputId]), [["job-benefit-retry", "benefit"]]);
});

test("business recipe fields reject unknown, missing, and invalid select values", () => {
  assert.throws(
    () => normalizeBusinessSkillInputs("xiaohongshu-cover", {
      "content-type": "Product recommendation",
      headline: "",
      "headline-style": "Friendly handwritten",
      "headline-position": "Top"
    }),
    /headline/i
  );
  assert.throws(
    () => normalizeBusinessSkillInputs("product-marketing-set", {
      "sales-channel": "Unknown channel",
      "primary-benefit": "Durable",
      "visual-style": "Clean studio"
    }),
    /sales-channel/i
  );
  assert.throws(
    () => normalizeBusinessSkillInputs("xiaohongshu-cover", {
      "content-type": "Product recommendation",
      headline: "秋日拿铁",
      "headline-style": "Friendly handwritten",
      "headline-position": "Top",
      injected: "not allowed"
    }),
    /injected/i
  );
});
