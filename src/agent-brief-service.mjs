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
import { createAgentRunIfAbsent, readAgentRun, updateAgentRun, writeAgentRun } from "./agent-run-store.mjs";
import { assetsDirFor } from "./paths.mjs";
import { readState } from "./store.mjs";

const imageMimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"]
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

export class AgentBriefClarificationAnswerError extends Error {
  constructor(questionIds, { reason }) {
    super(`Clarification answers contain ${reason} question ids: ${questionIds.join(", ")}.`);
    this.name = "AgentBriefClarificationAnswerError";
    this.code = "agent-brief-clarification-answer-invalid";
    this.statusCode = 400;
    this.questionIds = questionIds;
  }
}

export class AgentBriefSourceAssetError extends Error {
  constructor() {
    super("AgentRun source asset must be a supported regular image inside the active canvas assets directory.");
    this.name = "AgentBriefSourceAssetError";
    this.code = "agent-brief-source-asset-invalid";
    this.statusCode = 400;
  }
}

export async function analyzeAgentRun(projectDir, input, { analyze, repair } = {}) {
  if (typeof analyze !== "function") throw new TypeError("analyze must be a function");

  const analyzingRun = createAgentRun(input);
  await createAgentRunIfAbsent(projectDir, analyzingRun);
  const context = await buildAnalysisContext(projectDir, analyzingRun);
  const candidate = await produceValidatedCandidate({ analyze, repair, context });
  const nextStatus = hasUnansweredRequiredQuestions(candidate.clarificationQuestions, analyzingRun.clarificationAnswers) ? "needs_clarification" : "ready";
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
  validateClarificationAnswerSubmission(current, input?.answers);
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
    if (hasUnansweredRequiredQuestions(candidate.clarificationQuestions, clarificationAnswers)) {
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
  const stateCanvasId = stateCanvasIdForAgentRun(run.canvasId);
  const state = await readState(projectDir, { canvasId: stateCanvasId });
  const sourcesById = new Map(state.objects.map((object) => [object.id, object]));
  const sources = [];
  for (const objectId of run.sourceObjectIds) {
    const object = sourcesById.get(objectId);
    if (!object) throw new Error(`Source image ${JSON.stringify(objectId)} was not found.`);
    sources.push(await sourceContext(projectDir, stateCanvasId, object));
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

function stateCanvasIdForAgentRun(canvasId) {
  return canvasId === "shared" ? null : canvasId;
}

async function produceValidatedCandidate({ analyze, repair, context }) {
  let candidate = await analyze(context);
  try {
    validateAgentBriefCandidate(candidate, { sourceImageCount: context.request.sourceObjectIds.length });
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
      validateAgentBriefCandidate(candidate, { sourceImageCount: context.request.sourceObjectIds.length });
    } catch (repairError) {
      if (repairError instanceof AgentRunValidationError) throw new AgentBriefSchemaError(repairError);
      throw repairError;
    }
  }
  return candidate;
}

function hasUnansweredRequiredQuestions(questions, answers) {
  return questions.some((question) => (
    question.required
    && (typeof answers?.[question.id] !== "string" || !answers[question.id].trim())
  ));
}

function validateClarificationAnswerSubmission(run, answers) {
  if (!isPlainObject(answers)) {
    throw new AgentBriefClarificationAnswerError([], { reason: "non-object" });
  }
  const currentQuestionIds = new Set(run.clarificationQuestions.map((question) => question.id));
  const unknownIds = Object.keys(answers).filter((id) => !currentQuestionIds.has(id));
  if (unknownIds.length > 0) {
    throw new AgentBriefClarificationAnswerError(unknownIds, { reason: "unknown" });
  }
  const duplicateIds = Object.keys(answers).filter((id) => Object.hasOwn(run.clarificationAnswers, id));
  if (duplicateIds.length > 0) {
    throw new AgentBriefClarificationAnswerError(duplicateIds, { reason: "already answered" });
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function sourceContext(projectDir, canvasId, object) {
  if (object?.type !== "image") throw new AgentBriefSourceAssetError();
  const asset = object.assetPath ? await readSourceAsset(projectDir, canvasId, object.assetPath) : null;
  const remoteUrl = asset === null ? validatedRemoteImageUrl(object.src) : null;
  const mimeType = asset?.mimeType || mimeTypeFor(object);
  let dataUrl = null;
  if (asset) {
    dataUrl = `data:${mimeType};base64,${asset.bytes.toString("base64")}`;
  }
  return {
    objectId: object.id,
    name: object.name || "",
    mimeType,
    dataUrl,
    url: dataUrl === null ? remoteUrl : null,
    naturalWidth: Number.isFinite(object.naturalWidth) ? object.naturalWidth : null,
    naturalHeight: Number.isFinite(object.naturalHeight) ? object.naturalHeight : null,
    displayWidth: Number.isFinite(object.width) ? object.width : null,
    displayHeight: Number.isFinite(object.height) ? object.height : null,
    prompt: object.prompt || "",
    imagegenPrompt: object.imagegenPrompt || ""
  };
}

async function readSourceAsset(projectDir, canvasId, assetPath) {
  const assetsDir = path.resolve(assetsDirFor(projectDir, canvasId));
  const resolvedAssetPath = path.resolve(assetPath);
  if (!isInsidePath(assetsDir, resolvedAssetPath)) throw new AgentBriefSourceAssetError();
  let stat;
  try {
    stat = await fs.lstat(resolvedAssetPath);
  } catch {
    throw new AgentBriefSourceAssetError();
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new AgentBriefSourceAssetError();

  let realAssetsDir;
  let realAssetPath;
  try {
    [realAssetsDir, realAssetPath] = await Promise.all([
      fs.realpath(assetsDir),
      fs.realpath(resolvedAssetPath)
    ]);
  } catch {
    throw new AgentBriefSourceAssetError();
  }
  if (!isInsidePath(realAssetsDir, realAssetPath)) throw new AgentBriefSourceAssetError();
  const mimeType = imageMimeTypes.get(path.extname(realAssetPath).toLowerCase());
  if (!mimeType) throw new AgentBriefSourceAssetError();
  let bytes;
  try {
    bytes = await fs.readFile(realAssetPath);
  } catch {
    throw new AgentBriefSourceAssetError();
  }
  if (!hasImageSignature(bytes, mimeType)) throw new AgentBriefSourceAssetError();
  return { bytes, mimeType };
}

function validatedRemoteImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new AgentBriefSourceAssetError();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AgentBriefSourceAssetError();
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new AgentBriefSourceAssetError();
  }
  return url.toString();
}

function isInsidePath(directoryPath, candidatePath) {
  const relative = path.relative(directoryPath, candidatePath);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function hasImageSignature(bytes, mimeType) {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG";
  }
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/gif") {
    if (bytes.length < 6) return false;
    const signature = bytes.toString("ascii", 0, 6);
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  }
  if (mimeType === "image/avif") {
    if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
    const brands = [bytes.toString("ascii", 8, 12)];
    for (let offset = 16; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
      brands.push(bytes.toString("ascii", offset, offset + 4));
    }
    return brands.some((brand) => brand === "avif" || brand === "avis");
  }
  return false;
}

function mimeTypeFor(object) {
  const extension = path.extname(object.assetPath || object.name || object.src || "").toLowerCase();
  return imageMimeTypes.get(extension) || "application/octet-stream";
}
