import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AgentRunValidationError, validateAgentRun } from "./agent-run-contracts.mjs";
import { agentRunPathFor } from "./paths.mjs";

const runLocks = new Map();
const lockTimeoutMs = 15_000;
const staleLockMs = 5 * 60_000;
const lockRetryMs = 12;

export class AgentRunNotFoundError extends Error {
  constructor({ canvasId, agentRunId, filePath }) {
    super(`AgentRun ${JSON.stringify(agentRunId)} was not found for canvas ${JSON.stringify(canvasId)} at ${filePath}.`);
    this.name = "AgentRunNotFoundError";
    this.code = "agent-run-not-found";
    this.statusCode = 404;
    this.canvasId = canvasId;
    this.agentRunId = agentRunId;
    this.filePath = filePath;
  }
}

export class AgentRunCorruptError extends Error {
  constructor({ canvasId, agentRunId, filePath, cause }) {
    super(`AgentRun ${JSON.stringify(agentRunId)} contains invalid or corrupt data at ${filePath}: ${cause.message}`, { cause });
    this.name = "AgentRunCorruptError";
    this.code = "agent-run-corrupt";
    this.statusCode = 500;
    this.canvasId = canvasId;
    this.agentRunId = agentRunId;
    this.filePath = filePath;
  }
}

export class AgentRunAlreadyExistsError extends Error {
  constructor({ canvasId, agentRunId, filePath }) {
    super(`AgentRun ${JSON.stringify(agentRunId)} already exists for canvas ${JSON.stringify(canvasId)} at ${filePath}.`);
    this.name = "AgentRunAlreadyExistsError";
    this.code = "agent-run-already-exists";
    this.statusCode = 409;
    this.canvasId = canvasId;
    this.agentRunId = agentRunId;
    this.filePath = filePath;
  }
}

export async function writeAgentRun(projectDir, run) {
  validateAgentRun(run);
  const filePath = agentRunPathFor(projectDir, run.canvasId, run.id);
  return withRunLock(filePath, async () => writeAgentRunFile(filePath, run));
}

export async function createAgentRunIfAbsent(projectDir, run) {
  validateAgentRun(run);
  const filePath = agentRunPathFor(projectDir, run.canvasId, run.id);
  return withRunLock(filePath, async () => {
    try {
      await fs.lstat(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return writeAgentRunFile(filePath, run);
      throw error;
    }
    throw new AgentRunAlreadyExistsError({
      canvasId: run.canvasId,
      agentRunId: run.id,
      filePath
    });
  });
}

export async function readAgentRun(projectDir, { canvasId, agentRunId }) {
  assertLocator(canvasId, agentRunId);
  const filePath = agentRunPathFor(projectDir, canvasId, agentRunId);
  return readAgentRunFile(filePath, { canvasId, agentRunId });
}

export async function updateAgentRun(projectDir, { canvasId, agentRunId }, updater) {
  assertLocator(canvasId, agentRunId);
  if (typeof updater !== "function") {
    throw new AgentRunValidationError("must be a function", { path: "AgentRun updater" });
  }
  const filePath = agentRunPathFor(projectDir, canvasId, agentRunId);
  return withRunLock(filePath, async () => {
    const current = await readAgentRunFile(filePath, { canvasId, agentRunId });
    const next = await updater(current);
    validateAgentRun(next);
    if (next.id !== agentRunId || next.canvasId !== canvasId) {
      throw new AgentRunValidationError("cannot change id or canvasId", { path: "AgentRun updater" });
    }
    return writeAgentRunFile(filePath, next);
  });
}

async function readAgentRunFile(filePath, { canvasId, agentRunId }) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new AgentRunNotFoundError({ canvasId, agentRunId, filePath });
    throw error;
  }

  try {
    const run = JSON.parse(raw);
    validateAgentRun(run);
    if (run.canvasId !== canvasId || run.id !== agentRunId) {
      throw new AgentRunValidationError("stored identity does not match its directory", { path: "AgentRun" });
    }
    return run;
  } catch (cause) {
    if (cause instanceof AgentRunCorruptError) throw cause;
    throw new AgentRunCorruptError({ canvasId, agentRunId, filePath, cause });
  }
}

async function writeAgentRunFile(filePath, run) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let renamed = false;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
    await renameAtomicWithRetry(tempPath, filePath);
    renamed = true;
    return run;
  } finally {
    if (!renamed) await fs.unlink(tempPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function renameAtomicWithRetry(tempPath, filePath) {
  const startedAt = Date.now();
  for (;;) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      const retryable = process.platform === "win32" && (error?.code === "EPERM" || error?.code === "EACCES");
      if (!retryable || Date.now() - startedAt >= 2_000) throw error;
      await new Promise((resolve) => setTimeout(resolve, 8 + Math.floor(Math.random() * 8)));
    }
  }
}

async function withRunLock(filePath, operation) {
  const previous = runLocks.get(filePath) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => {}).then(() => current);
  runLocks.set(filePath, chain);
  await previous.catch(() => {});
  try {
    return await withCrossProcessLock(`${filePath}.lock`, operation);
  } finally {
    release();
    if (runLocks.get(filePath) === chain) runLocks.delete(filePath);
  }
}

async function withCrossProcessLock(lockPath, operation) {
  const lock = await acquireCrossProcessLock(lockPath);
  try {
    return await operation();
  } finally {
    await releaseCrossProcessLock(lockPath, lock);
  }
}

async function acquireCrossProcessLock(lockPath) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  for (;;) {
    let handle;
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      return { handle, token };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
      }
      if (!isLockContention(error)) throw error;
      if (error?.code === "EEXIST") await removeAbandonedLock(lockPath);
      if (Date.now() - startedAt >= lockTimeoutMs) {
        const timeout = new Error(`Timed out waiting for AgentRun lock: ${lockPath}`);
        timeout.code = "agent-run-lock-timeout";
        timeout.statusCode = 503;
        throw timeout;
      }
      const jitter = Math.floor(Math.random() * lockRetryMs);
      await new Promise((resolve) => setTimeout(resolve, lockRetryMs + jitter));
    }
  }
}

async function removeAbandonedLock(lockPath) {
  let stat;
  let owner = null;
  try {
    [stat, owner] = await Promise.all([
      fs.stat(lockPath),
      fs.readFile(lockPath, "utf8").then((raw) => JSON.parse(raw)).catch(() => null)
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const age = Date.now() - stat.mtimeMs;
  const ownerAlive = Number.isInteger(owner?.pid) ? processIsAlive(owner.pid) : null;
  if (ownerAlive === false) {
    await fs.unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return;
  }
  if (age < staleLockMs) return;
  if (ownerAlive === true) return;
  await fs.unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function releaseCrossProcessLock(lockPath, lock) {
  await lock.handle.close().catch(() => {});
  let owner;
  try {
    owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    return;
  }
  if (owner?.token !== lock.token) return;
  await fs.unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function assertLocator(canvasId, agentRunId) {
  assertStorageIdentifier(canvasId, "canvasId");
  assertStorageIdentifier(agentRunId, "agentRunId");
}

function assertStorageIdentifier(value, pathName) {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[/\\\0\r\n]/.test(value) || value === "." || value === "..") {
    throw new AgentRunValidationError("must be a non-empty path-safe identifier", { path: pathName });
  }
}

function isLockContention(error) {
  return error?.code === "EEXIST"
    || (process.platform === "win32" && (error?.code === "EPERM" || error?.code === "EACCES"));
}

function processIsAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}
