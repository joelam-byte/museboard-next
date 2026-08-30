import fs from "node:fs/promises";
import path from "node:path";
import {
  AgentRunValidationError,
  SKILL_DESCRIPTORS,
  SKILL_IDS,
  createAgentRun,
  transitionAgentRun,
  validateAgentBriefCandidate,
  validateAgentRun
} from "./agent-run-contracts.mjs";
import { readAgentRun, updateAgentRun, writeAgentRun } from "./agent-run-store.mjs";
import { readState } from "./store.mjs";

const imageMimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

export class AgentBriefSchemaError extends Error {
  constructor(cause) {
    super(`Agent brief output remained invalid after one schema-repair attempt: ${cause.message}`, { cause });
    this.name = "AgentBriefSchemaError";
    this.code = "agent-brief-schema-invalid";
    this.statusCode = 422;
  }
}

export class AgentBriefClarificationError extends Error {
  constructor(missingQuestionIds) {
    super(`AgentRun still requires answers for: ${missingQuestionIds.join(", ")}.`);
    this.name = "AgentBriefClarificationError";
    this.code = "agent-brief-clarification-required";
    this.statusCode = 409;
    this.missingQuestionIds = missingQuestionIds;
  }
}

export async function analyzeAgentRun(projectDir, input, { analyze, repair } = {}) {
  if (typeof analyze !== "function") throw new TypeError("analyze must be a function");

  const analyzingRun = createAgentRun(input);
  await writeAgentRun(projectDir, analyzingRun);
  const context = await buildAnalysisContext(projectDir, analyzingRun);
  const candidate = await produceValidatedCandidate({ analyze, repair, context });
  const nextStatus = candidate.clarificationQuestions.some((question) => question.required)
    ? "needs_clarification"
    : "ready";
  const ready = transitionAgentRun(analyzingRun, nextStatus, {
    recommendedSkillId: candidate.recommendedSkillId,
    selectedSkillId: candidate.recommendedSkillId,
    structuredBrief: candidate.structuredBrief,
    clarificationQuestions: candidate.clarificationQuestions,
    optimizedPrompt: candidate.optimizedPrompt,
    plannedOutputs: candidate.plannedOutputs
  });
  return writeAgentRun(projectDir, ready);
}

export async function answerAgentRunClarifications(
  projectDir,
  input,
  { analyze, repair, now = new Date().toISOString() } = {}
) {
  const current = await readAgentRun(projectDir, input);
  const clarificationAnswers = {
    ...current.clarificationAnswers,
    ...input.answers
  };
  const missingQuestionIds = current.clarificationQuestions
    .filter((question) => question.required)
    .map((question) => question.id)
    .filter((id) => typeof clarificationAnswers[id] !== "string" || !clarificationAnswers[id].trim());
  if (missingQuestionIds.length > 0) throw new AgentBriefClarificationError(missingQuestionIds);
  if (typeof analyze !== "function") throw new TypeError("analyze must be a function");

  const context = await buildAnalysisContext(projectDir, { ...current, clarificationAnswers });
  const candidate = await produceValidatedCandidate({ analyze, repair, context });
  return updateAgentRun(projectDir, input, (latest) => {
    if (latest.status !== "needs_clarification" || latest.timestamps.updatedAt !== current.timestamps.updatedAt) {
      const error = new Error("AgentRun changed while clarification answers were being analyzed.");
      error.code = "agent-brief-concurrent-update";
      error.statusCode = 409;
      throw error;
    }
    const selectedSkillId = current.selectedSkillId !== current.recommendedSkillId
      ? current.selectedSkillId
      : candidate.recommendedSkillId;
    const patch = {
      clarificationAnswers,
      recommendedSkillId: candidate.recommendedSkillId,
      selectedSkillId,
      structuredBrief: candidate.structuredBrief,
      clarificationQuestions: candidate.clarificationQuestions,
      optimizedPrompt: candidate.optimizedPrompt,
      plannedOutputs: candidate.plannedOutputs
    };
    if (candidate.clarificationQuestions.some((question) => question.required)) {
      if (Date.parse(now) < Date.parse(latest.timestamps.updatedAt)) {
        throw new AgentRunValidationError("must not move backward", { path: "AgentRun.timestamps.updatedAt" });
      }
      return validateAgentRun({
        ...latest,
        ...patch,
        timestamps: {
          ...latest.timestamps,
          updatedAt: now
        }
      });
    }
    return transitionAgentRun(latest, "ready", patch, { now });
  });
}

export async function selectAgentRunSkill(projectDir, input, { now = new Date().toISOString() } = {}) {
  return updateAgentRun(projectDir, input, (current) => {
    if (!["needs_clarification", "ready"].includes(current.status)) {
      const error = new Error(`AgentRun Skill cannot be changed while status is ${current.status}.`);
      error.code = "agent-brief-skill-selection-closed";
      error.statusCode = 409;
      throw error;
    }
    if (Date.parse(now) < Date.parse(current.timestamps.updatedAt)) {
      throw new AgentRunValidationError("must not move backward", { path: "AgentRun.timestamps.updatedAt" });
    }
    const next = {
      ...current,
      selectedSkillId: input.selectedSkillId,
      optimizedPrompt: input.optimizedPrompt,
      timestamps: {
        ...current.timestamps,
        updatedAt: now
      }
    };
    return validateAgentRun(next);
  });
}

async function buildAnalysisContext(projectDir, run) {
  const state = await readState(projectDir, { canvasId: run.canvasId });
  const sourcesById = new Map(state.objects.map((object) => [object.id, object]));
  const sources = [];
  for (const objectId of run.sourceObjectIds) {
    const object = sourcesById.get(objectId);
    if (!object) throw new Error(`Source image ${JSON.stringify(objectId)} was not found.`);
    sources.push(await sourceContext(object));
  }
  return {
    request: {
      agentRunId: run.id,
      canvasId: run.canvasId,
      rawRequest: run.rawRequest,
      sourceObjectIds: [...run.sourceObjectIds],
      clarificationAnswers: { ...(run.clarificationAnswers || {}) }
    },
    sources,
    allowedSkillIds: [...SKILL_IDS],
    skillDescriptors: SKILL_DESCRIPTORS.map((descriptor) => ({
      ...descriptor,
      sourceImageCount: { ...descriptor.sourceImageCount },
      outputCount: { ...descriptor.outputCount }
    }))
  };
}

async function produceValidatedCandidate({ analyze, repair, context }) {
  let candidate = await analyze(context);
  try {
    validateAgentBriefCandidate(candidate);
  } catch (validationError) {
    if (!(validationError instanceof AgentRunValidationError)) throw validationError;
    candidate = typeof repair === "function"
      ? await repair({ candidate, validationError, context })
      : await analyze(context, {
        mode: "schema-repair",
        candidate,
        validationError: {
          code: validationError.code,
          message: validationError.message,
          path: validationError.path
        }
      });
    try {
      validateAgentBriefCandidate(candidate);
    } catch (repairError) {
      if (repairError instanceof AgentRunValidationError) throw new AgentBriefSchemaError(repairError);
      throw repairError;
    }
  }
  return candidate;
}

async function sourceContext(object) {
  const mimeType = mimeTypeFor(object);
  let dataUrl = null;
  if (object.assetPath) {
    const bytes = await fs.readFile(object.assetPath);
    dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  }
  return {
    objectId: object.id,
    name: object.name || "",
    mimeType,
    dataUrl,
    url: dataUrl === null && typeof object.src === "string" ? object.src : null,
    naturalWidth: Number.isFinite(object.naturalWidth) ? object.naturalWidth : null,
    naturalHeight: Number.isFinite(object.naturalHeight) ? object.naturalHeight : null,
    displayWidth: Number.isFinite(object.width) ? object.width : null,
    displayHeight: Number.isFinite(object.height) ? object.height : null,
    prompt: object.prompt || "",
    imagegenPrompt: object.imagegenPrompt || ""
  };
}

function mimeTypeFor(object) {
  const extension = path.extname(object.assetPath || object.name || object.src || "").toLowerCase();
  return imageMimeTypes.get(extension) || "application/octet-stream";
}
