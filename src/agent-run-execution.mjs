import {
  SKILL_IDS,
  createAgentRun,
  transitionAgentRun
} from "./agent-run-contracts.mjs";
import { createAgentRunIfAbsent, updateAgentRun } from "./agent-run-store.mjs";

const existingImageActions = new Set(["quick-edit", "expand", "remove-bg", "edit-text", "edit-elements"]);

export class AgentRunExecutionError extends Error {
  constructor(message, { code = "agent-run-execution-invalid", statusCode = 409 } = {}) {
    super(message);
    this.name = "AgentRunExecutionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function prepareAgentRunForJob(
  projectDir,
  { canvasId, agentRunId = null, jobId, action, sourceObject, prompt = "" },
  { now = new Date().toISOString() } = {}
) {
  assertExistingImageAction(action);
  assertJobSource(sourceObject);
  if (typeof jobId !== "string" || !jobId.trim()) {
    throw new AgentRunExecutionError("Image jobs require a path-safe job id.", {
      code: "agent-run-job-id-invalid",
      statusCode: 400
    });
  }

  if (typeof agentRunId === "string" && agentRunId.trim()) {
    return startExistingAgentRun(projectDir, {
      canvasId,
      agentRunId: agentRunId.trim(),
      jobId,
      action,
      sourceObjectId: sourceObject.id,
      now
    });
  }

  const directRunId = `run_${jobId}`;
  const initial = createAgentRun({
    id: directRunId,
    canvasId,
    sourceObjectIds: [sourceObject.id],
    rawRequest: directActionRequest(action, prompt)
  }, { now });
  const ready = transitionAgentRun(initial, "ready", directReadyPatch(action, sourceObject, prompt), { now });
  await createAgentRunIfAbsent(projectDir, ready);
  return startExistingAgentRun(projectDir, {
    canvasId,
    agentRunId: directRunId,
    jobId,
    action,
    sourceObjectId: sourceObject.id,
    now
  });
}

export async function recordAgentRunJobSuccess(
  projectDir,
  { canvasId, agentRunId, jobId, outputObjectIds },
  { now = new Date().toISOString() } = {}
) {
  return updateAgentRun(projectDir, { canvasId, agentRunId }, (current) => {
    if (current.status !== "running") return current;
    const outputIds = uniqueIdentifiers(outputObjectIds);
    const plannedOutputs = updatePlannedOutput(current, jobId, (output) => ({
      ...output,
      status: "succeeded",
      jobId,
      outputObjectIds: outputIds,
      error: null
    }));
    return transitionAgentRun(current, "succeeded", {
      plannedOutputs,
      outputObjectIds: uniqueIdentifiers([...current.outputObjectIds, ...outputIds]),
      error: null
    }, { now });
  });
}

export async function recordAgentRunJobFailure(
  projectDir,
  { canvasId, agentRunId, jobId, error },
  { now = new Date().toISOString() } = {}
) {
  return updateAgentRun(projectDir, { canvasId, agentRunId }, (current) => {
    if (current.status !== "running") return current;
    const failure = failureFor(error);
    const plannedOutputs = updatePlannedOutput(current, jobId, (output) => ({
      ...output,
      status: "failed",
      jobId,
      error: failure
    }));
    return transitionAgentRun(current, "failed", {
      plannedOutputs,
      error: failure
    }, { now });
  });
}

async function startExistingAgentRun(projectDir, { canvasId, agentRunId, jobId, action, sourceObjectId, now }) {
  return updateAgentRun(projectDir, { canvasId, agentRunId }, (current) => {
    if (current.status === "running" && current.childJobIds.includes(jobId)) return current;
    if (current.status !== "ready") {
      throw new AgentRunExecutionError(`AgentRun cannot start an image job while status is ${current.status}.`, {
        code: "agent-run-execution-state"
      });
    }
    if (current.selectedSkillId !== action || !SKILL_IDS.includes(action)) {
      throw new AgentRunExecutionError(`AgentRun Skill ${JSON.stringify(current.selectedSkillId)} does not match image job action ${JSON.stringify(action)}.`, {
        code: "agent-run-execution-skill-mismatch",
        statusCode: 400
      });
    }
    if (!current.sourceObjectIds.includes(sourceObjectId)) {
      throw new AgentRunExecutionError("Image job source is not one of the AgentRun reference images.", {
        code: "agent-run-execution-source-mismatch",
        statusCode: 400
      });
    }
    if (current.plannedOutputs.length !== 1) {
      throw new AgentRunExecutionError("Existing image-edit Skills require exactly one planned output.", {
        code: "agent-run-execution-output-count",
        statusCode: 400
      });
    }
    return transitionAgentRun(current, "running", {
      childJobIds: [jobId],
      plannedOutputs: current.plannedOutputs.map((output) => ({
        ...output,
        status: "running",
        jobId,
        outputObjectIds: [],
        error: null
      }))
    }, { now });
  });
}

function directReadyPatch(action, sourceObject, prompt) {
  const normalizedPrompt = normalizedPromptFor(action, prompt);
  return {
    recommendedSkillId: action,
    selectedSkillId: action,
    structuredBrief: {
      modifications: [directActionRequest(action, normalizedPrompt)],
      preservationRules: ["Preserve all source details outside the requested image-edit operation."],
      style: "Preserve the source image style unless the requested edit requires a change.",
      materials: [],
      composition: "Keep the existing source composition unless the selected Skill changes its frame.",
      textRequirements: action === "edit-text" ? ["Apply only the requested text replacements."] : [],
      outputRequirements: ["One PNG result from the selected existing image-edit Skill."]
    },
    optimizedPrompt: normalizedPrompt,
    plannedOutputs: [{
      id: "output-main",
      label: "Result",
      purpose: "Result from the selected existing image-edit Skill.",
      format: "png",
      width: positiveDimension(sourceObject.naturalWidth),
      height: positiveDimension(sourceObject.naturalHeight),
      aspectRatio: "source",
      status: "planned",
      jobId: null,
      outputObjectIds: [],
      error: null
    }]
  };
}

function updatePlannedOutput(run, jobId, updater) {
  let matched = false;
  const plannedOutputs = run.plannedOutputs.map((output, index) => {
    if (output.jobId === jobId || (!output.jobId && index === 0)) {
      matched = true;
      return updater(output);
    }
    return output;
  });
  if (!matched) {
    throw new AgentRunExecutionError(`AgentRun does not contain image job ${JSON.stringify(jobId)}.`, {
      code: "agent-run-execution-job-mismatch",
      statusCode: 400
    });
  }
  return plannedOutputs;
}

function assertExistingImageAction(action) {
  if (typeof action !== "string" || !existingImageActions.has(action)) {
    throw new AgentRunExecutionError(`Unsupported existing image-edit action: ${action || "(missing)"}.`, {
      code: "agent-run-execution-action-invalid",
      statusCode: 400
    });
  }
}

function assertJobSource(sourceObject) {
  if (!sourceObject || typeof sourceObject.id !== "string" || !sourceObject.id.trim()) {
    throw new AgentRunExecutionError("Image jobs require a source canvas image.", {
      code: "agent-run-execution-source-invalid",
      statusCode: 400
    });
  }
}

function directActionRequest(action, prompt) {
  return `${actionLabel(action)}: ${normalizedPromptFor(action, prompt)}`;
}

function normalizedPromptFor(action, prompt) {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (trimmed) return trimmed.slice(0, 20_000);
  if (action === "remove-bg") return "Remove the background and preserve the foreground subject.";
  if (action === "edit-elements") return "Separate the source image into editable visual layers.";
  if (action === "expand") return "Expand the image naturally beyond its current bounds.";
  if (action === "edit-text") return "Apply the requested text replacements while preserving the surrounding design.";
  return "Apply the requested Quick Edit while preserving the rest of the source image.";
}

function actionLabel(action) {
  return {
    "quick-edit": "Quick Edit",
    expand: "Expand",
    "remove-bg": "Remove BG",
    "edit-text": "Edit Text",
    "edit-elements": "Edit Elements"
  }[action] || action;
}

function positiveDimension(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function uniqueIdentifiers(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].slice(0, 100);
}

function failureFor(error) {
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim().slice(0, 10_000)
    : String(error || "Image job failed.").slice(0, 10_000);
  return {
    code: "image-job-failed",
    message,
    retryable: true
  };
}
