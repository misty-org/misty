import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { deviceAgentOperations } from "../../personal/device_agent_tools";

const nativeList = readFileSync("src-tauri/tauri-permissions/actions/agent_jobs.in", "utf8");
const listed = new Set([...nativeList.matchAll(/^\s*"([^"]+)",$/gm)].map((match) => match[1]));

it("runs only jobs the native list allows", () => {
  expect(listed.size).toBeGreaterThan(0);
  for (const operation of deviceAgentOperations) expect(listed).toContain(operation);
  const dispatcher = readFileSync("src/features/agents/runs/jobs/worker_execute.ts", "utf8");
  for (const [, operation] of dispatcher.matchAll(/job\.operation === "([^"]+)"/g))
    expect(listed).toContain(operation);
});
