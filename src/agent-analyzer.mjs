import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexExecutable, spawnCodexProcess } from "./codex-runner.mjs";
import { agentRunPathFor } from "./paths.mjs";

const extensionForMimeType = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"]
]);

export class AgentAnalyzerOutputError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "AgentAnalyzerOutputError";
    this.code = "agent-analyzer-output-invalid";
    this.statusCode = 502;
  }
}

export function createCodexAgentAnalyzer({ projectDir = path.join(os.tmpdir(), "museboard-agent-analysis"), runCodex = runCodexStructuredAnalysis } = {}) {
  if (typeof runCodex !== "function") throw new TypeError("runCodex must be a function");
  const resolvedProjectDir = path.resolve(projectDir);

  return async function analyzeWithCodex(context, options = {}) {
    const analysisDir = path.join(
      path.dirname(agentRunPathFor(resolvedProjectDir, context.request.canvasId, context.request.agentRunId)),
      "analysis"
    );
    const inputDir = path.join(analysisDir, "inputs");
    const outputPath = path.join(analysisDir, options.mode === "schema-repair" ? "brief-repair.json" : "brief.json");
    const logPath = path.join(analysisDir, options.mode === "schema-repair" ? "brief-repair.log" : "brief.log");
    await fs.mkdir(inputDir, { recursive: true });
    const imagePaths = await writeSourceImages(inputDir, context.sources);
    await runCodex({
      projectDir: resolvedProjectDir,
      imagePaths,
      outputPath,
      logPath,
      prompt: promptForAnalysis(context, outputPath, options)
    });
    return readCandidate(outputPath);
  };
}

export async function runCodexStructuredAnalysis({ projectDir, imagePaths, outputPath, logPath, prompt }) {
  const executable = await resolveCodexExecutable();
  const model = process.env.CODEX_CANVAS_CODEX_MODEL;
  const requestedReasoningEffort = process.env.CODEX_CANVAS_CODEX_REASONING_EFFORT || "low";
  const reasoningEffort = requestedReasoningEffort === "minimal" ? "low" : requestedReasoningEffort;
  const args = ["exec", "--ephemeral"];
  if (model) args.push("--model", model);
  args.push("--skip-git-repo-check", "--color", "never", "-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`, "--cd", projectDir, "--sandbox", "danger-full-access");
  for (const imagePath of imagePaths) args.push("--image", imagePath);
  args.push("--", "-");

  const child = spawnCodexProcess(executable, args, {
    cwd: projectDir,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  const output = [];
  const append = (chunk) => {
    const text = chunk.toString();
    output.push(text);
    fs.appendFile(logPath, text).catch(() => {});
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) return resolve();
      const detail = output.join("").trim().split(/\r?\n/).filter(Boolean).at(-1) || signal || `exit code ${code}`;
      reject(new AgentAnalyzerOutputError(`Codex agent analysis failed: ${detail}`));
    });
  });
}

async function writeSourceImages(inputDir, sources) {
  const imagePaths = [];
  for (const [index, source] of sources.entries()) {
    if (!source.dataUrl) continue;
    const extension = extensionForMimeType.get(source.mimeType);
    if (!extension) throw new AgentAnalyzerOutputError(`Unsupported analysis image type: ${source.mimeType}.`);
    const encoded = /^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/.exec(source.dataUrl);
    if (!encoded) throw new AgentAnalyzerOutputError(`Source image ${JSON.stringify(source.objectId)} has an invalid data URL.`);
    const imagePath = path.join(inputDir, `${String(index + 1).padStart(2, "0")}-${safeFileStem(source.objectId)}${extension}`);
    await fs.writeFile(imagePath, Buffer.from(encoded[1], "base64"), { flag: "w" });
    imagePaths.push(imagePath);
  }
  return imagePaths;
}

function promptForAnalysis(context, outputPath, options) {
  const remoteSources = context.sources
    .filter((source) => source.dataUrl === null && source.url)
    .map((source) => ({ objectId: source.objectId, url: source.url }));
  const repairInstruction = options.mode === "schema-repair"
    ? `Repair the previous candidate below. Return a corrected replacement that fixes the validation error.\nPrevious candidate: ${JSON.stringify(options.candidate)}\nValidation error: ${JSON.stringify(options.validationError)}`
    : "Create a new analysis candidate.";
  const inputSummary = context.sources.map((source, index) => ({
    position: index + 1,
    objectId: source.objectId,
    name: source.name,
    width: source.naturalWidth,
    height: source.naturalHeight,
    prompt: source.prompt
  }));
  return [
    "You are the Museboard Agent planner. Inspect the attached local image references and interpret the user's request.",
    "Do not call imagegen. Do not edit or generate images. Do not modify repository files outside the exact JSON output path below.",
    "Ask only outcome-changing questions. Use required=true only when the image output cannot be correctly produced without an answer.",
    "Choose exactly one allowed Skill. The result must stay within its source-image and output-count constraints.",
    "Return only JSON matching the candidate schema; no Markdown fences, commentary, or extra fields.",
    `Write the JSON to this exact path: ${outputPath}`,
    "",
    `User request: ${context.request.rawRequest}`,
    `Existing clarification answers: ${JSON.stringify(context.request.clarificationAnswers)}`,
    `Image references: ${JSON.stringify(inputSummary)}`,
    `Remote source URLs not attached as files: ${JSON.stringify(remoteSources)}`,
    `Allowed skills: ${JSON.stringify(context.skillDescriptors)}`,
    "Candidate schema:",
    JSON.stringify({
      recommendedSkillId: "one allowed Skill id",
      structuredBrief: {
        modifications: ["string"],
        preservationRules: ["string"],
        style: "string",
        materials: ["string"],
        composition: "string",
        textRequirements: ["string"],
        outputRequirements: ["string"]
      },
      clarificationQuestions: [{ id: "path-safe-id", prompt: "string", required: true, options: ["string"] }],
      optimizedPrompt: "string",
      plannedOutputs: [{
        id: "path-safe-id",
        label: "string",
        purpose: "string",
        format: "png|webp|jpeg",
        width: 1080,
        height: 1440,
        aspectRatio: "3:4",
        status: "planned",
        jobId: null,
        outputObjectIds: [],
        error: null
      }]
    }),
    "",
    repairInstruction
  ].join("\n");
}

async function readCandidate(outputPath) {
  let raw;
  try {
    raw = await fs.readFile(outputPath, "utf8");
  } catch (cause) {
    throw new AgentAnalyzerOutputError("Codex agent analysis did not write its required JSON output.", { cause });
  }
  try {
    const candidate = JSON.parse(raw);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("JSON root must be an object.");
    }
    return candidate;
  } catch (cause) {
    throw new AgentAnalyzerOutputError("Codex agent analysis wrote invalid JSON.", { cause });
  }
}

function safeFileStem(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "source";
}
