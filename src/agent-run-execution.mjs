import {
  SKILL_IDS,
  createAgentRun,
  transitionAgentRun
} from "./agent-run-contracts.mjs";
import { normalizeBusinessSkillInputs } from "./business-skill-recipes.mjs";
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

export async function prepareAgentRunForGenerationJob(
  projectDir,
  { canvasId, agentRunId, jobId, action = "generate-image" },
  { now = new Date().toISOString() } = {}
) {
  return updateAgentRun(projectDir, { canvasId, agentRunId }, (current) => {
    if (current.status === "running" && current.childJobIds.includes(jobId)) return current;
    if (current.status !== "ready") {
      throw new AgentRunExecutionError(`AgentRun cannot start a generated image while status is ${current.status}.`, {
        code: "agent-run-generation-state"
      });
    }
    if (action !== "generate-image" || current.selectedSkillId !== action) {
      throw new AgentRunExecutionError("Generated image action must match the selected generate-image Skill.", {
        code: "agent-run-generation-skill-mismatch",
        statusCode: 400
      });
    }
    if (current.sourceObjectIds.length !== 0) {
      throw new AgentRunExecutionError("The generate-image Skill must not include canvas reference images.", {
        code: "agent-run-generation-source-mismatch",
        statusCode: 400
      });
    }
    if (current.plannedOutputs.length !== 1) {
      throw new AgentRunExecutionError("The generate-image Skill requires exactly one planned output.", {
        code: "agent-run-generation-output-count",
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

export async function recordAgentRunJobSuccess(
  projectDir,
  { canvasId, agentRunId, jobId, outputObjectIds },
  { now = new Date().toISOString() } = {}
) {
  return updateAgentRun(projectDir, { canvasId, agentRunId }, (current) => {
    if (current.status !== "running") return current;
    const plannedOutputs = updatePlannedOutput(current, jobId, (output) => ({
      ...output,
      status: "succeeded",
      jobId,
      outputObjectIds: uniqueIdentifiers(outputObjectIds),
      error: null
    }));
    return settleAgentRun(current, plannedOutputs, { now });
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
    return settleAgentRun(current, plannedOutputs, { now });
  });
}

export async function startAgentRunBatch(
  projectDir,
  { canvasId, agentRunId, action, sourceObjectIds, jobs, skillInputs },
  { now = new Date().toISOString() } = {}
) {
  assertBusinessBatch(action, sourceObjectIds, jobs);
  const normalizedSkillInputs = normalizeBusinessSkillInputs(action, skillInputs);
  return updateAgentRun(projectDir, { canvasId, agentRunId }, (current) => {
    if (current.status === "running" && sameJobIds(current.childJobIds, jobs)) return current;
    if (current.status !== "ready") {
      throw new AgentRunExecutionError(`AgentRun cannot start a business batch while status is ${current.status}.`, {
        code: "agent-run-batch-state"
      });
    }
    if (current.selectedSkillId !== action || !SKILL_IDS.includes(action)) {
      throw new AgentRunExecutionError(`AgentRun Skill ${JSON.stringify(current.selectedSkillId)} does not match business batch action ${JSON.stringify(action)}.`, {
        code: "agent-run-batch-skill-mismatch",
        statusCode: 400
      });
    }
    if (!sameIdentifiers(current.sourceObjectIds, sourceObjectIds)) {
      throw new AgentRunExecutionError("Business batch sources do not match the AgentRun reference images.", {
        code: "agent-run-batch-source-mismatch",
        statusCode: 400
      });
    }
    if (!sameIdentifiers(current.plannedOutputs.map((output) => output.id), jobs.map((job) => job.outputId))) {
      throw new AgentRunExecutionError("Business batch jobs must cover every planned output exactly once.", {
        code: "agent-run-batch-output-mismatch",
        statusCode: 400
      });
    }
    return transitionAgentRun(current, "running", {
      childJobIds: jobs.map((job) => job.id),
      plannedOutputs: current.plannedOutputs.map((output) => {
        const job = jobs.find((candidate) => candidate.outputId === output.id);
        return {
          ...output,
          status: "running",
          jobId: job.id,
          outputObjectIds: [],
          error: null
        };
      }),
      skillInputs: normalizedSkillInputs,
      error: null
    }, { now });
  });
}

export async function retryAgentRunJobs(
  projectDir,
  { canvasId, agentRunId, jobs },
  { now = new Date().toISOString() } = {}
) {
  assertRetryJobs(jobs);
  return updateAgentRun(projectDir, { canvasId, agentRunId }, (current) => {
    if (!new Set(["partial", "failed"]).has(current.status)) {
      throw new AgentRunExecutionError(`AgentRun cannot retry failed outputs while status is ${current.status}.`, {
        code: "agent-run-retry-state"
      });
    }
    for (const job of jobs) {
      const output = current.plannedOutputs.find((candidate) => candidate.id === job.outputId);
      if (!output || output.status !== "failed") {
        throw new AgentRunExecutionError(`AgentRun output ${JSON.stringify(job.outputId)} is not a failed retry target.`, {
          code: "agent-run-retry-output-invalid",
          statusCode: 400
        });
      }
    }
    return transitionAgentRun(current, "running", {
      childJobIds: uniqueIdentifiers([...current.childJobIds, ...jobs.map((job) => job.id)]),
      plannedOutputs: current.plannedOutputs.map((output) => {
        const job = jobs.find((candidate) => candidate.outputId === output.id);
        return job ? {
          ...output,
          status: "running",
          jobId: job.id,
          outputObjectIds: [],
          error: null
        } : output;
      }),
      error: null
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

function settleAgentRun(run, plannedOutputs, { now }) {
  const outputObjectIds = uniqueIdentifiers(plannedOutputs.flatMap((output) => output.outputObjectIds));
  if (plannedOutputs.every((output) => output.status === "succeeded")) {
    return transitionAgentRun(run, "succeeded", {
      plannedOutputs,
      outputObjectIds,
      error: null
    }, { now });
  }
  if (plannedOutputs.some((output) => output.status === "running" || output.status === "queued" || output.status === "planned")) {
    return updateRunningAgentRun(run, { plannedOutputs, outputObjectIds, error: null }, now);
  }
  const failures = plannedOutputs.filter((output) => output.status === "failed");
  if (failures.length > 0 && failures.length < plannedOutputs.length) {
    return transitionAgentRun(run, "partial", {
      plannedOutputs,
      outputObjectIds,
      error: null
    }, { now });
  }
  if (failures.length === plannedOutputs.length) {
    return transitionAgentRun(run, "failed", {
      plannedOutputs,
      outputObjectIds,
      error: failures[0].error || failureFor(new Error("Every planned output failed."))
    }, { now });
  }
  return updateRunningAgentRun(run, { plannedOutputs, outputObjectIds, error: null }, now);
}

function updateRunningAgentRun(run, patch, now) {
  return {
    ...run,
    ...patch,
    timestamps: {
      ...run.timestamps,
      updatedAt: now
    }
  };
}

function assertBusinessBatch(action, sourceObjectIds, jobs) {
  if (!new Set(["xiaohongshu-cover", "product-marketing-set"]).has(action)) {
    throw new AgentRunExecutionError(`Unsupported business batch action: ${action || "(missing)"}.`, {
      code: "agent-run-batch-action-invalid",
      statusCode: 400
    });
  }
  if (!Array.isArray(sourceObjectIds) || sourceObjectIds.length < 1 || sourceObjectIds.length > 3 || uniqueIdentifiers(sourceObjectIds).length !== sourceObjectIds.length) {
    throw new AgentRunExecutionError("Business batches require one to three unique source object ids.", {
      code: "agent-run-batch-sources-invalid",
      statusCode: 400
    });
  }
  assertRetryJobs(jobs);
}

function assertRetryJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > 16) {
    throw new AgentRunExecutionError("AgentRun jobs require one to sixteen output assignments.", {
      code: "agent-run-jobs-invalid",
      statusCode: 400
    });
  }
  const ids = [];
  const outputIds = [];
  for (const job of jobs) {
    if (!job || typeof job.id !== "string" || !job.id.trim() || typeof job.outputId !== "string" || !job.outputId.trim()) {
      throw new AgentRunExecutionError("AgentRun jobs require path-safe job and output ids.", {
        code: "agent-run-job-identifiers-invalid",
        statusCode: 400
      });
    }
    ids.push(job.id.trim());
    outputIds.push(job.outputId.trim());
  }
  if (uniqueIdentifiers(ids).length !== ids.length || uniqueIdentifiers(outputIds).length !== outputIds.length) {
    throw new AgentRunExecutionError("AgentRun jobs must not duplicate job or output ids.", {
      code: "agent-run-jobs-duplicate",
      statusCode: 400
    });
  }
}

function sameIdentifiers(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameJobIds(currentJobIds, jobs) {
  return sameIdentifiers(currentJobIds, jobs.map((job) => job.id));
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
