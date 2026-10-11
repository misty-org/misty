import { expect, it } from "vitest";
import { browserAgentExecutionRequest, jobSiteBlocks } from "./workerBrowserJobs";

it("passes the account's blocked sites from the job to the native request", () => {
  expect(jobSiteBlocks({ siteBlocks: { sensitive: false, sites: ["example.com", 3] } })).toEqual({
    sensitive: false,
    sites: ["example.com"],
  });
  // Missing or malformed blocks leave the native default: sensitive sites blocked.
  expect(jobSiteBlocks({})).toBeUndefined();
  expect(jobSiteBlocks({ siteBlocks: { sites: "x" } })).toEqual({ sensitive: true, sites: [] });
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
      siteBlocks: { sensitive: true, sites: ["bank.example"] },
    },
  });
  expect(request.siteBlocks).toEqual({ sensitive: true, sites: ["bank.example"] });
  // The model's own arguments never carry blocks.
  expect(request.input).not.toHaveProperty("siteBlocks");
});
