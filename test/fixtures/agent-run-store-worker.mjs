import fs from "node:fs/promises";
import { updateAgentRun } from "../../src/agent-run-store.mjs";

const [projectDir, canvasId, agentRunId, startPath, answerId, answer] = process.argv.slice(2);

while (true) {
  try {
    await fs.access(startPath);
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const updated = await updateAgentRun(projectDir, { canvasId, agentRunId }, async (run) => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return {
    ...run,
    clarificationAnswers: {
      ...run.clarificationAnswers,
      [answerId]: answer
    }
  };
});

console.log(JSON.stringify({ id: updated.id, answers: updated.clarificationAnswers }));
