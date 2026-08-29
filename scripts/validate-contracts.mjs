#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_DESCRIPTORS, SKILL_IDS, validateSkillDescriptor } from "../src/agent-run-contracts.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageJson = await readJson("package.json");
const plugin = await readJson(".codex-plugin/plugin.json");
const mcp = await readJson(".mcp.json");

assert(packageJson.name === "museboard", "package.json must use the museboard package name");
assert(packageJson.bin?.museboard === "./bin/museboard.mjs", "package.json must expose bin/museboard.mjs");
assert(plugin.name === packageJson.name, "plugin name must match package name");
assert(plugin.version === packageJson.version, "plugin version must match package version");
assert(plugin.interface?.displayName === "Museboard", "plugin display name must be Museboard");
assert(Boolean(mcp.mcpServers?.museboard), ".mcp.json must expose the museboard server");
assert(!mcp.mcpServers?.["codex-canvas"], ".mcp.json must not expose the upstream server name");

for (const descriptor of SKILL_DESCRIPTORS) validateSkillDescriptor(descriptor);
assert(SKILL_DESCRIPTORS.length === SKILL_IDS.length, "every stable AgentRun Skill id must have one descriptor");
assert(new Set(SKILL_DESCRIPTORS.map((descriptor) => descriptor.id)).size === SKILL_IDS.length, "AgentRun Skill descriptors must use unique stable ids");

await validateSkill("SKILL.md", "museboard");
for (const entry of await fs.readdir(path.join(rootDir, "skills"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  await validateSkill(path.join("skills", entry.name, "SKILL.md"), entry.name);
}

console.log(JSON.stringify({
  ok: true,
  plugin: plugin.name,
  version: plugin.version,
  agentRunSkillIds: SKILL_IDS
}, null, 2));

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(rootDir, relativePath), "utf8"));
}

async function validateSkill(relativePath, expectedName) {
  const source = await fs.readFile(path.join(rootDir, relativePath), "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(frontmatter, `${relativePath} must start with YAML frontmatter`);
  const name = frontmatter[1].match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim();
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  assert(name === expectedName, `${relativePath} must declare name: ${expectedName}`);
  assert(Boolean(description), `${relativePath} must declare a description`);
  assert(!/Codex-Canvas/.test(source), `${relativePath} must use Museboard user-facing branding`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
