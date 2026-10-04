import { expect, it } from "vitest";
import { globalMistyError } from "./globalMistyActions";
it("shows bounded native string errors while rejecting blank or arbitrary payloads", () => {
  expect(globalMistyError(" agent_task_paused ")).toBe("agent_task_paused");
  expect(globalMistyError(new Error("denied"))).toBe("denied");
  expect(globalMistyError("x".repeat(1000))).toHaveLength(600);
  for (const value of [undefined, null, {}, " "])
    expect(globalMistyError(value)).toBe("Misty could not complete that request.");
});
