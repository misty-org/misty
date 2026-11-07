import { expect, it } from "vitest";
import { browserAgentExecutionRequest, jobPolicyCall } from "./workerBrowserJobs";

it("passes the tool call to native code, and no policy of its own", () => {
  expect(jobPolicyCall({ policyCall: "call-1" })).toBe("call-1");
  expect(jobPolicyCall({ policyCall: 3 })).toBeUndefined();
  expect(jobPolicyCall(null)).toBeUndefined();
  const request = browserAgentExecutionRequest({
    id: "job-1",
    runId: "run",
    nodeId: "n",
    scopeId: "scope-1",
    operation: "browser.steps",
    contextId: "ctx",
    attempt: 1,
    input: { steps: [] },
    config: {
      agentId: "agent",
      taskId: "task",
      policyCall: "call-1",
      // What an old job might still carry reaches nothing.
      siteBlocks: { sensitive: false, sites: [] },
      confirmKinds: [],
      grantSet: { mode: "auto", grants: [] },
    },
  });
  expect(request.policyCall).toBe("call-1");
  for (const field of ["siteBlocks", "confirmKinds", "grantSet"]) {
    expect(request).not.toHaveProperty(field);
    expect(request.input).not.toHaveProperty(field);
  }
});
