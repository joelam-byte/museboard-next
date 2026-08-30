import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("Agent panel exposes descriptor-driven business fields and failed-output retry control", async () => {
  const [html, app] = await Promise.all([
    fs.readFile(path.join(projectRoot, "public", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "public", "app.js"), "utf8")
  ]);

  assert.match(html, /id="agentSkillFields"/);
  assert.match(html, /id="agentRetryButton"/);
  assert.match(app, /function renderAgentSkillFields/);
  assert.match(app, /skillInputs/);
  assert.match(app, /\/retry/);
  assert.match(app, /function retryActiveAgentRun/);
});
