import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeDocuments } = await import("./fakeDocuments");
  return { invoke: fakeDocuments.invoke };
});
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

const { fakeDocuments } = await import("./fakeDocuments");
const { browserReplayForRun, buildBrowserReplay, recordWorkflowReplay } =
  await import("./workflowReplays");

const locator = { role: "button", name: "Go" };
const steps = {
  operation: "browser.steps",
  input: { steps: [{ action: "click", ref: "e1" }] },
  output: { steps: [{ index: 1, ok: true, locator }] },
};
const browser = {
  kind: "browser_tab",
  opaqueRef: "scope-1",
  capabilities: ["browser.steps", "browser.snapshot"],
};

beforeEach(() => fakeDocuments.reset());

describe("buildBrowserReplay", () => {
  it("names controls by locator and takes the start from the first read", () => {
    expect(
      buildBrowserReplay(
        ["browser.snapshot", "browser.steps"],
        [{ operation: "browser.snapshot", input: {}, output: { url: "https://a.test" } }, steps],
      ),
    ).toEqual({
      startUrl: "https://a.test",
      calls: [{ tool: "browser.steps", args: { steps: [{ action: "click", locator }] } }],
    });
  });

  it("refuses what it can't reproduce exactly", () => {
    expect(buildBrowserReplay(["note.write"], [steps])).toBeNull();
    expect(
      buildBrowserReplay([], [{ operation: "browser.extract", input: {}, output: {} }]),
    ).toBeNull();
    expect(
      buildBrowserReplay([], [{ ...steps, output: { steps: [{ index: 1, ok: true }] } }]),
    ).toBeNull();
    expect(buildBrowserReplay([], [])).toBeNull();
  });
});

describe("a workflow's replay", () => {
  const run = { methodVersionId: "version", runId: "run" };

  it("reaches a run only with a browser that can act by ref", async () => {
    await recordWorkflowReplay("a", { ...run, toolNames: [], jobs: [steps] });
    await expect(browserReplayForRun("a", "version", [])).resolves.toBeNull();
    await expect(browserReplayForRun("a", "version", [browser])).resolves.toMatchObject({
      scope_id: "scope-1",
      calls: [{ tool: "browser.steps" }],
    });
    await expect(browserReplayForRun("a", "other", [browser])).resolves.toBeNull();
  });

  it("is forgotten when a later run can't be replayed", async () => {
    await recordWorkflowReplay("a", { ...run, toolNames: [], jobs: [steps] });
    await recordWorkflowReplay("a", { ...run, toolNames: ["note.write"], jobs: [] });
    await expect(browserReplayForRun("a", "version", [browser])).resolves.toBeNull();
  });
});
