import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { deviceAgentOperations } from "./deviceAgentTools";

const nativeList = readFileSync("src-tauri/sandbox/actions/agent_jobs.in", "utf8");
const listed = new Set([...nativeList.matchAll(/^\s*"([^"]+)",$/gm)].map((match) => match[1]));

it("runs only jobs the native list allows", () => {
  expect(listed.size).toBeGreaterThan(0);
  for (const operation of deviceAgentOperations) expect(listed).toContain(operation);
  const dispatcher = readFileSync("src/features/agents/workerExecute.ts", "utf8");
  for (const [, operation] of dispatcher.matchAll(/job\.operation === "([^"]+)"/g))
    expect(listed).toContain(operation);
});
