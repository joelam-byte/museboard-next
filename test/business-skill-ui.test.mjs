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
test("Agent workbench exposes History and Assets tabs with explicit rerun and reinsert flows", async () => {
  const [html, app] = await Promise.all([
    fs.readFile(path.join(projectRoot, "public", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "public", "app.js"), "utf8")
  ]);

  assert.match(html, /data-agent-tab="history"/);
  assert.match(html, /data-agent-tab="assets"/);
  assert.match(html, /id="historyPanel"/);
  assert.match(html, /id="assetsPanel"/);
  assert.match(html, /id="agentRunHistory"/);
  assert.match(html, /id="canvasAssetList"/);
  assert.match(app, /function loadAgentRunHistory/);
  assert.match(app, /function restoreAgentRunDraft/);
  assert.match(app, /function copyAgentRunSummary/);
  assert.match(app, /function loadCanvasAssets/);
  assert.match(app, /\/api\/assets\//);
  assert.match(app, /\/insert/);
});
