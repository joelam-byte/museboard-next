import { SKILL_DESCRIPTORS } from "./agent-run-contracts.mjs";

const businessSkillIds = new Set(["xiaohongshu-cover", "product-marketing-set"]);
const safeIdentifierPattern = /^[^/\\\0\r\n.][^/\\\0\r\n]*$/;
const maximumFieldLength = 4_000;

export class BusinessSkillRecipeError extends Error {
  constructor(message, { statusCode = 400, code = "business-skill-recipe-invalid" } = {}) {
    super(message);
    this.name = "BusinessSkillRecipeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function normalizeBusinessSkillInputs(skillId, input) {
  const descriptor = businessDescriptor(skillId);
  if (!isPlainObject(input)) {
    throw new BusinessSkillRecipeError("Business Skill fields must be an object.", {
      code: "business-skill-inputs-invalid"
    });
  }

  const fieldsById = new Map(descriptor.briefFields.map((field) => [field.id, field]));
  for (const id of Object.keys(input)) {
    if (!fieldsById.has(id)) {
      throw new BusinessSkillRecipeError(`Business Skill field ${JSON.stringify(id)} is not supported by ${descriptor.id}.`, {
        code: "business-skill-input-unknown"
      });
    }
  }

  const normalized = {};
  for (const field of descriptor.briefFields) {
    const value = normalizeFieldValue(input[field.id], field);
    if (field.required && !value) {
      throw new BusinessSkillRecipeError(`Business Skill field ${JSON.stringify(field.id)} is required.`, {
        code: "business-skill-input-required"
      });
    }
    if (field.type === "select" && value && !field.options.includes(value)) {
      throw new BusinessSkillRecipeError(`Business Skill field ${JSON.stringify(field.id)} must use one of its listed options.`, {
        code: "business-skill-input-option"
      });
    }
    normalized[field.id] = value;
  }
  return Object.freeze(normalized);
}

export function buildBusinessSkillJobPlan({
  skillId,
  sourceObjectIds,
  optimizedPrompt,
  skillInputs,
  plannedOutputs,
  outputIds,
  jobIds
}) {
  const descriptor = businessDescriptor(skillId);
  const normalizedSources = normalizeIdentifiers(sourceObjectIds, "Business Skill sourceObjectIds", { min: 1, max: 3 });
  const inputs = normalizeBusinessSkillInputs(skillId, skillInputs);
  const outputs = normalizePlannedOutputs(descriptor, plannedOutputs);
  const requestedOutputIds = outputIds === undefined
    ? outputs.map((output) => output.id)
    : normalizeIdentifiers(outputIds, "Business Skill outputIds", { min: 1, max: outputs.length });
  if (requestedOutputIds.some((id) => !outputs.some((output) => output.id === id))) {
    throw new BusinessSkillRecipeError("Business Skill outputIds must name fixed recipe slots.", {
      code: "business-skill-output-selection-invalid"
    });
  }
  const selectedOutputs = outputs.filter((output) => requestedOutputIds.includes(output.id));
  const normalizedJobIds = normalizeIdentifiers(jobIds, "Business Skill jobIds", {
    min: selectedOutputs.length,
    max: selectedOutputs.length
  });
  const direction = normalizeRequiredText(optimizedPrompt, "Business Skill optimized prompt", 60_000);

  return Object.freeze(selectedOutputs.map((output, index) => Object.freeze({
    id: normalizedJobIds[index],
    action: descriptor.backendAction,
    outputId: output.id,
    sourceObjectIds: Object.freeze([...normalizedSources]),
    output: Object.freeze({
      id: output.id,
      label: output.label,
      purpose: output.purpose,
      format: output.format,
      width: output.width,
      height: output.height,
      aspectRatio: output.aspectRatio
    }),
    prompt: buildBackendPrompt({
      descriptor,
      output,
      direction,
      inputs
    })
  })));
}

function businessDescriptor(skillId) {
  if (!businessSkillIds.has(skillId)) {
    throw new BusinessSkillRecipeError(`Unsupported business Skill: ${JSON.stringify(skillId)}.`, {
      code: "business-skill-id-invalid"
    });
  }
  const descriptor = SKILL_DESCRIPTORS.find((candidate) => candidate.id === skillId);
  if (!descriptor) throw new Error(`Missing registered business Skill descriptor: ${skillId}`);
  return descriptor;
}

function normalizePlannedOutputs(descriptor, plannedOutputs) {
  if (!Array.isArray(plannedOutputs) || plannedOutputs.length !== descriptor.outputSpecs.length) {
    throw new BusinessSkillRecipeError(`${descriptor.name} requires exactly ${descriptor.outputSpecs.length} planned output slot(s).`, {
      code: "business-skill-output-count"
    });
  }
  const outputsById = new Map(plannedOutputs.map((output) => [output?.id, output]));
  if (outputsById.size !== plannedOutputs.length) {
    throw new BusinessSkillRecipeError("Business Skill planned output ids must be unique.", {
      code: "business-skill-output-duplicate"
    });
  }
  return descriptor.outputSpecs.map((spec) => {
    const output = outputsById.get(spec.id);
    if (!output) {
      throw new BusinessSkillRecipeError(`Business Skill output slot ${JSON.stringify(spec.id)} is required.`, {
        code: "business-skill-output-missing"
      });
    }
    for (const key of ["id", "label", "purpose", "format", "width", "height", "aspectRatio"]) {
      if (output[key] !== spec[key]) {
        throw new BusinessSkillRecipeError(`Business Skill output slot ${JSON.stringify(spec.id)} does not match its fixed recipe.`, {
          code: "business-skill-output-recipe-mismatch"
        });
      }
    }
    return output;
  });
}

function normalizeFieldValue(value, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new BusinessSkillRecipeError(`Business Skill field ${JSON.stringify(field.id)} must be text.`, {
      code: "business-skill-input-type"
    });
  }
  const normalized = value.trim();
  if (normalized.length > maximumFieldLength) {
    throw new BusinessSkillRecipeError(`Business Skill field ${JSON.stringify(field.id)} is too long.`, {
      code: "business-skill-input-length"
    });
  }
  return normalized;
}

function normalizeIdentifiers(value, label, { min, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new BusinessSkillRecipeError(`${label} must contain ${min === max ? min : `between ${min} and ${max}`} item(s).`, {
      code: "business-skill-identifiers-invalid"
    });
  }
  const ids = value.map((id) => normalizeIdentifier(id, label));
  if (new Set(ids).size !== ids.length) {
    throw new BusinessSkillRecipeError(`${label} must not contain duplicate ids.`, {
      code: "business-skill-identifiers-duplicate"
    });
  }
  return ids;
}

function normalizeIdentifier(value, label) {
  if (typeof value !== "string" || !value.trim() || !safeIdentifierPattern.test(value.trim())) {
    throw new BusinessSkillRecipeError(`${label} must contain path-safe ids.`, {
      code: "business-skill-identifier-invalid"
    });
  }
  return value.trim();
}

function normalizeRequiredText(value, label, maximumLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BusinessSkillRecipeError(`${label} is required.`, {
      code: "business-skill-prompt-required"
    });
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new BusinessSkillRecipeError(`${label} is too long.`, {
      code: "business-skill-prompt-length"
    });
  }
  return normalized;
}

function buildBackendPrompt({ descriptor, output, direction, inputs }) {
  const fieldLines = descriptor.briefFields
    .filter((field) => inputs[field.id])
    .map((field) => `${field.label}: ${JSON.stringify(inputs[field.id])}`);
  const outputDirection = descriptor.id === "product-marketing-set"
    ? productOutputDirection(output.id, inputs)
    : "Create one finished Xiaohongshu cover. Render the supplied Chinese headline exactly once at the requested position and style.";

  return [
    `Museboard business Skill: ${descriptor.name}`,
    `Fixed output slot: ${output.label} — ${output.purpose}`,
    `Output requirement: one ${output.format.toUpperCase()} image at ${output.width} × ${output.height} pixels (${output.aspectRatio}).`,
    "",
    "User-approved creative direction:",
    direction,
    "",
    "Structured business fields:",
    ...fieldLines,
    "",
    "Output-specific direction:",
    outputDirection,
    "",
    "Preserve all source-reference identity, product geometry, logos, and elements explicitly marked for preservation. Do not invent unrelated readable text, watermarks, UI, or collage panels."
  ].join("\n");
}

function productOutputDirection(outputId, inputs) {
  const benefit = inputs["primary-benefit"];
  const audience = inputs["target-audience"];
  if (outputId === "main") return "Create the primary listing image: a clear, accurate hero presentation of the product with immediate visual hierarchy.";
  if (outputId === "benefit") return `Create the key benefit image, communicating this primary benefit visually and credibly: ${benefit}`;
  if (outputId === "scene") return `Create the lifestyle scene image for this audience: ${audience || "the stated target audience"}.`;
  if (outputId === "detail") return "Create the product detail image, focusing on one accurate material, finish, or construction feature.";
  throw new Error(`Unsupported product marketing output slot: ${outputId}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
