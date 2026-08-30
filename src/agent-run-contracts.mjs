const skillIds = [
  "quick-edit",
  "expand",
  "remove-bg",
  "edit-text",
  "edit-elements",
  "xiaohongshu-cover",
  "product-marketing-set"
];

export const SKILL_IDS = Object.freeze([...skillIds]);

export const SKILL_DESCRIPTORS = Object.freeze([
  skillDescriptor("quick-edit", "Quick Edit", "Edit selected regions while preserving the rest of the source image.", 1, 1, 1, 1),
  skillDescriptor("expand", "Expand", "Extend a source image beyond its current bounds.", 1, 1, 1, 1),
  skillDescriptor("remove-bg", "Remove BG", "Remove the source image background and preserve the foreground subject.", 1, 1, 1, 1),
  skillDescriptor("edit-text", "Edit Text", "Recognize and replace selected text while preserving the surrounding design.", 1, 1, 1, 1),
  skillDescriptor("edit-elements", "Edit Elements", "Separate source image elements into editable visual layers.", 1, 1, 1, 16),
  skillDescriptor("xiaohongshu-cover", "Xiaohongshu Cover", "Create one Chinese social cover from one to three source images.", 1, 3, 1, 1),
  skillDescriptor("product-marketing-set", "Product Marketing Set", "Create a coordinated set of independent product marketing images.", 1, 3, 1, 16)
]);

export const AGENT_RUN_STATUSES = Object.freeze([
  "analyzing",
  "needs_clarification",
  "ready",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled"
]);

export const PLANNED_OUTPUT_STATUSES = Object.freeze([
  "planned",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);

const skillIdSet = new Set(SKILL_IDS);
const agentRunStatusSet = new Set(AGENT_RUN_STATUSES);
const plannedOutputStatusSet = new Set(PLANNED_OUTPUT_STATUSES);
const outputFormats = new Set(["png", "jpeg", "webp"]);
const transitions = new Map([
  ["analyzing", new Set(["needs_clarification", "ready"])],
  ["needs_clarification", new Set(["ready"])],
  ["ready", new Set(["running"])],
  ["running", new Set(["succeeded", "partial", "failed", "cancelled"])],
  ["succeeded", new Set()],
  ["partial", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()]
]);
const transitionPatchFields = new Set([
  "recommendedSkillId",
  "selectedSkillId",
  "structuredBrief",
  "clarificationQuestions",
  "clarificationAnswers",
  "optimizedPrompt",
  "plannedOutputs",
  "childJobIds",
  "outputObjectIds",
  "error"
]);

export class AgentRunValidationError extends Error {
  constructor(message, { path = null } = {}) {
    super(path ? `${path}: ${message}` : message);
    this.name = "AgentRunValidationError";
    this.code = "agent-run-validation";
    this.statusCode = 400;
    this.path = path;
  }
}

export class AgentRunTransitionError extends Error {
  constructor(from, to) {
    super(`Illegal AgentRun status transition: ${from} -> ${to}.`);
    this.name = "AgentRunTransitionError";
    this.code = "agent-run-transition";
    this.statusCode = 409;
    this.from = from;
    this.to = to;
  }
}

export function validateSkillDescriptor(value) {
  assertStrictObject(value, "SkillDescriptor", [
    "id",
    "name",
    "description",
    "sourceImageCount",
    "outputCount",
    "requiresConfirmation"
  ]);
  assertSkillId(value.id, "SkillDescriptor.id");
  assertNonEmptyString(value.name, "SkillDescriptor.name", 120);
  assertNonEmptyString(value.description, "SkillDescriptor.description", 1000);
  validateCountRange(value.sourceImageCount, "SkillDescriptor.sourceImageCount", { max: 3 });
  validateCountRange(value.outputCount, "SkillDescriptor.outputCount", { max: 16 });
  if (value.requiresConfirmation !== true) {
    invalid("must be true", "SkillDescriptor.requiresConfirmation");
  }
  return value;
}

export function validateStructuredBrief(value) {
  assertStrictObject(value, "StructuredBrief", [
    "modifications",
    "preservationRules",
    "style",
    "materials",
    "composition",
    "textRequirements",
    "outputRequirements"
  ]);
  assertStringArray(value.modifications, "StructuredBrief.modifications", { min: 1, max: 50, itemMax: 4000 });
  assertStringArray(value.preservationRules, "StructuredBrief.preservationRules", { max: 50, itemMax: 4000 });
  assertNullableString(value.style, "StructuredBrief.style", 4000);
  assertStringArray(value.materials, "StructuredBrief.materials", { max: 50, itemMax: 1000 });
  assertNullableString(value.composition, "StructuredBrief.composition", 4000);
  assertStringArray(value.textRequirements, "StructuredBrief.textRequirements", { max: 100, itemMax: 4000 });
  assertStringArray(value.outputRequirements, "StructuredBrief.outputRequirements", { min: 1, max: 50, itemMax: 4000 });
  return value;
}

export function validateAgentBriefCandidate(value) {
  assertStrictObject(value, "AgentBriefCandidate", [
    "recommendedSkillId",
    "structuredBrief",
    "clarificationQuestions",
    "optimizedPrompt",
    "plannedOutputs"
  ]);
  assertSkillId(value.recommendedSkillId, "AgentBriefCandidate.recommendedSkillId");
  validateStructuredBrief(value.structuredBrief);
  validateClarificationQuestions(value.clarificationQuestions);
  assertNonEmptyString(value.optimizedPrompt, "AgentBriefCandidate.optimizedPrompt", 60_000);
  if (!Array.isArray(value.plannedOutputs) || value.plannedOutputs.length === 0) {
    invalid("must contain at least one item", "AgentBriefCandidate.plannedOutputs");
  }
  value.plannedOutputs.forEach((output, index) => {
    const outputPath = `AgentBriefCandidate.plannedOutputs[${index}]`;
    validatePlannedOutput(output, outputPath);
    if (
      output.status !== "planned"
      || output.jobId !== null
      || output.outputObjectIds.length !== 0
      || output.error !== null
    ) {
      invalid("must describe an unstarted planned output", outputPath);
    }
  });
  assertUniqueValues(value.plannedOutputs.map((output) => output.id), "AgentBriefCandidate.plannedOutputs", "output ids");
  return value;
}

export function validatePlannedOutput(value, path = "PlannedOutput") {
  assertStrictObject(value, path, [
    "id",
    "label",
    "purpose",
    "format",
    "width",
    "height",
    "aspectRatio",
    "status",
    "jobId",
    "outputObjectIds",
    "error"
  ]);
  assertIdentifier(value.id, `${path}.id`);
  assertNonEmptyString(value.label, `${path}.label`, 300);
  assertNonEmptyString(value.purpose, `${path}.purpose`, 4000);
  if (!outputFormats.has(value.format)) invalid("must be png, jpeg, or webp", `${path}.format`);
  assertNullableDimension(value.width, `${path}.width`);
  assertNullableDimension(value.height, `${path}.height`);
  assertNullableString(value.aspectRatio, `${path}.aspectRatio`, 80);
  if (!plannedOutputStatusSet.has(value.status)) invalid("has an unsupported value", `${path}.status`);
  assertNullableIdentifier(value.jobId, `${path}.jobId`);
  assertIdentifierArray(value.outputObjectIds, `${path}.outputObjectIds`, { max: 100, allowEmpty: true });
  validateRunError(value.error, `${path}.error`);
  if (value.status === "failed" && value.error === null) invalid("is required when status is failed", `${path}.error`);
  return value;
}

export function validateAgentRun(value) {
  assertStrictObject(value, "AgentRun", [
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
  assertIdentifier(value.id, "AgentRun.id");
  assertIdentifier(value.canvasId, "AgentRun.canvasId");
  assertIdentifierArray(value.sourceObjectIds, "AgentRun.sourceObjectIds", { min: 1, max: 3 });
  assertNonEmptyString(value.rawRequest, "AgentRun.rawRequest", 20_000);
  assertNullableSkillId(value.recommendedSkillId, "AgentRun.recommendedSkillId");
  assertNullableSkillId(value.selectedSkillId, "AgentRun.selectedSkillId");
  if (value.structuredBrief !== null) validateStructuredBrief(value.structuredBrief);
  validateClarificationQuestions(value.clarificationQuestions);
  validateClarificationAnswers(value.clarificationAnswers);
  assertString(value.optimizedPrompt, "AgentRun.optimizedPrompt", 60_000);
  if (!Array.isArray(value.plannedOutputs)) invalid("must be an array", "AgentRun.plannedOutputs");
  value.plannedOutputs.forEach((output, index) => validatePlannedOutput(output, `AgentRun.plannedOutputs[${index}]`));
  assertUniqueValues(value.plannedOutputs.map((output) => output.id), "AgentRun.plannedOutputs", "output ids");
  assertIdentifierArray(value.childJobIds, "AgentRun.childJobIds", { max: 100, allowEmpty: true });
  assertIdentifierArray(value.outputObjectIds, "AgentRun.outputObjectIds", { max: 100, allowEmpty: true });
  if (!agentRunStatusSet.has(value.status)) invalid("has an unsupported value", "AgentRun.status");
  validateRunError(value.error, "AgentRun.error");
  validateTimestamps(value.timestamps);
  validateAgentRunState(value);
  return value;
}

export function createAgentRun(input, { now = new Date().toISOString() } = {}) {
  assertIsoTimestamp(now, "AgentRun.timestamps.createdAt");
  const run = {
    id: input?.id,
    canvasId: input?.canvasId,
    sourceObjectIds: input?.sourceObjectIds,
    rawRequest: input?.rawRequest,
    recommendedSkillId: null,
    selectedSkillId: null,
    structuredBrief: null,
    clarificationQuestions: [],
    clarificationAnswers: {},
    optimizedPrompt: "",
    plannedOutputs: [],
    childJobIds: [],
    outputObjectIds: [],
    status: "analyzing",
    error: null,
    timestamps: {
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now
    }
  };
  return validateAgentRun(run);
}

export function transitionAgentRun(run, nextStatus, patch = {}, { now = new Date().toISOString() } = {}) {
  validateAgentRun(run);
  if (!agentRunStatusSet.has(nextStatus) || !transitions.get(run.status)?.has(nextStatus)) {
    throw new AgentRunTransitionError(run.status, nextStatus);
  }
  assertIsoTimestamp(now, "AgentRun.timestamps.updatedAt");
  if (Date.parse(now) < Date.parse(run.timestamps.updatedAt)) {
    invalid("must not move backward", "AgentRun.timestamps.updatedAt");
  }
  if (!isPlainObject(patch)) invalid("must be an object", "AgentRun transition patch");
  for (const key of Object.keys(patch)) {
    if (!transitionPatchFields.has(key)) invalid(`contains unknown field ${JSON.stringify(key)}`, "AgentRun transition patch");
  }
  const next = {
    ...run,
    ...patch,
    status: nextStatus,
    timestamps: {
      ...run.timestamps,
      updatedAt: now,
      statusChangedAt: now
    }
  };
  return validateAgentRun(next);
}

function skillDescriptor(id, name, description, sourceMin, sourceMax, outputMin, outputMax) {
  return Object.freeze({
    id,
    name,
    description,
    sourceImageCount: Object.freeze({ min: sourceMin, max: sourceMax }),
    outputCount: Object.freeze({ min: outputMin, max: outputMax }),
    requiresConfirmation: true
  });
}

function validateCountRange(value, path, { max }) {
  assertStrictObject(value, path, ["min", "max"]);
  if (!Number.isInteger(value.min) || value.min < 1 || value.min > max) invalid(`min must be an integer from 1 to ${max}`, path);
  if (!Number.isInteger(value.max) || value.max < value.min || value.max > max) invalid(`max must be an integer from min to ${max}`, path);
}

function validateClarificationQuestions(value) {
  if (!Array.isArray(value)) invalid("must be an array", "AgentRun.clarificationQuestions");
  if (value.length > 50) invalid("must contain at most 50 questions", "AgentRun.clarificationQuestions");
  value.forEach((question, index) => {
    const path = `AgentRun.clarificationQuestions[${index}]`;
    assertStrictObject(question, path, ["id", "prompt", "required", "options"]);
    assertIdentifier(question.id, `${path}.id`);
    assertNonEmptyString(question.prompt, `${path}.prompt`, 4000);
    if (typeof question.required !== "boolean") invalid("must be a boolean", `${path}.required`);
    assertStringArray(question.options, `${path}.options`, { max: 50, itemMax: 1000 });
  });
  assertUniqueValues(value.map((question) => question.id), "AgentRun.clarificationQuestions", "question ids");
}

function validateClarificationAnswers(value) {
  if (!isPlainObject(value)) invalid("must be an object", "AgentRun.clarificationAnswers");
  if (Object.keys(value).length > 50) invalid("must contain at most 50 answers", "AgentRun.clarificationAnswers");
  for (const [id, answer] of Object.entries(value)) {
    assertIdentifier(id, `AgentRun.clarificationAnswers.${id}`);
    assertNonEmptyString(answer, `AgentRun.clarificationAnswers.${id}`, 4000);
  }
}

function validateRunError(value, path) {
  if (value === null) return;
  assertStrictObject(value, path, ["code", "message", "retryable"]);
  assertIdentifier(value.code, `${path}.code`);
  assertNonEmptyString(value.message, `${path}.message`, 10_000);
  if (typeof value.retryable !== "boolean") invalid("must be a boolean", `${path}.retryable`);
}

function validateTimestamps(value) {
  assertStrictObject(value, "AgentRun.timestamps", ["createdAt", "updatedAt", "statusChangedAt"]);
  assertIsoTimestamp(value.createdAt, "AgentRun.timestamps.createdAt");
  assertIsoTimestamp(value.updatedAt, "AgentRun.timestamps.updatedAt");
  assertIsoTimestamp(value.statusChangedAt, "AgentRun.timestamps.statusChangedAt");
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    invalid("must not be earlier than createdAt", "AgentRun.timestamps.updatedAt");
  }
  if (Date.parse(value.statusChangedAt) < Date.parse(value.createdAt)) {
    invalid("must not be earlier than createdAt", "AgentRun.timestamps.statusChangedAt");
  }
}

function validateAgentRunState(run) {
  if (run.status === "needs_clarification" && run.clarificationQuestions.length === 0) {
    invalid("requires at least one clarification question", "AgentRun.clarificationQuestions");
  }
  if (["ready", "running", "succeeded", "partial", "failed", "cancelled"].includes(run.status)) {
    if (run.structuredBrief === null) invalid(`is required when status is ${run.status}`, "AgentRun.structuredBrief");
    if (run.selectedSkillId === null) invalid(`is required when status is ${run.status}`, "AgentRun.selectedSkillId");
    if (!run.optimizedPrompt.trim()) invalid(`is required when status is ${run.status}`, "AgentRun.optimizedPrompt");
    if (run.plannedOutputs.length === 0) invalid(`requires at least one item when status is ${run.status}`, "AgentRun.plannedOutputs");
  }
  if (run.status === "failed" && run.error === null) invalid("is required when status is failed", "AgentRun.error");
}

function assertStrictObject(value, path, fields) {
  if (!isPlainObject(value)) invalid("must be an object", path);
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`contains unknown field ${JSON.stringify(key)}`, path);
  }
  for (const key of fields) {
    if (!Object.hasOwn(value, key)) invalid(`is missing required field ${JSON.stringify(key)}`, path);
  }
}

function assertIdentifier(value, path) {
  assertNonEmptyString(value, path, 300);
  if (/[/\\\0\r\n]/.test(value) || value === "." || value === "..") {
    invalid("must be a path-safe identifier", path);
  }
}

function assertNullableIdentifier(value, path) {
  if (value === null) return;
  assertIdentifier(value, path);
}

function assertSkillId(value, path) {
  if (!skillIdSet.has(value)) invalid(`must be one of ${SKILL_IDS.join(", ")}`, path);
}

function assertNullableSkillId(value, path) {
  if (value === null) return;
  assertSkillId(value, path);
}

function assertIdentifierArray(value, path, { min = 0, max, allowEmpty = false } = {}) {
  if (!Array.isArray(value)) invalid("must be an array", path);
  if (!allowEmpty && value.length < min) invalid(`must contain at least ${min} item${min === 1 ? "" : "s"}`, path);
  if (value.length > max) invalid(`must contain at most ${max} items`, path);
  value.forEach((item, index) => assertIdentifier(item, `${path}[${index}]`));
  assertUniqueValues(value, path, "values");
}

function assertUniqueValues(value, path, label) {
  if (new Set(value).size !== value.length) invalid(`must contain unique ${label}`, path);
}

function assertStringArray(value, path, { min = 0, max, itemMax }) {
  if (!Array.isArray(value)) invalid("must be an array", path);
  if (value.length < min) invalid(`must contain at least ${min} item${min === 1 ? "" : "s"}`, path);
  if (value.length > max) invalid(`must contain at most ${max} items`, path);
  value.forEach((item, index) => assertNonEmptyString(item, `${path}[${index}]`, itemMax));
}

function assertNullableDimension(value, path) {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 1 || value > 16_384) invalid("must be null or an integer from 1 to 16384", path);
}

function assertNullableString(value, path, max) {
  if (value === null) return;
  assertNonEmptyString(value, path, max);
}

function assertNonEmptyString(value, path, max) {
  assertString(value, path, max);
  if (!value.trim()) invalid("must not be empty", path);
}

function assertString(value, path, max) {
  if (typeof value !== "string") invalid("must be a string", path);
  if (value.length > max) invalid(`must contain at most ${max} characters`, path);
}

function assertIsoTimestamp(value, path) {
  assertNonEmptyString(value, path, 40);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) invalid("must be an ISO 8601 UTC timestamp", path);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message, path) {
  throw new AgentRunValidationError(message, { path });
}

for (const descriptor of SKILL_DESCRIPTORS) validateSkillDescriptor(descriptor);
