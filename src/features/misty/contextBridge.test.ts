import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  accountId: "a",
  decide: vi.fn(async () => {}),
  undo: vi.fn(async () => {}),
  state: {} as any,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => false }));
vi.mock("@/features/apps/useAppsStore", () => ({
  useAppsStore: { getState: () => ({ accountId: fixture.accountId }) },
}));
vi.mock("./availability", () => ({ assertMistyAvailable: vi.fn(async () => {}) }));
vi.mock("./context", () => ({
  contextOptions: () => [],
  resolveMistyContext: () => ({ context: [] }),
}));
vi.mock("@/features/ai-surface/store", () => ({
  useAiSurfaceStore: { getState: () => fixture.state, setState: vi.fn() },
}));
import { requestHostContext } from "./contextBridge";
beforeEach(() => {
  vi.clearAllMocks();
  fixture.accountId = "a";
  fixture.state = {
    registrations: {
      "a:p": {
        paneId: "p",
        adapter: { getContext: () => [{ id: "doc", kind: "note", spaceId: "s" }] },
      },
    },
    companion: {
      approval: {
        artifact: { id: "artifact-current", expiresAt: new Date(Date.now() + 60000).toISOString() },
      },
    },
    decideArtifact: fixture.decide,
    undoLast: fixture.undo,
  };
});
it("rejects another account and closed sources before forwarding effects", async () => {
  await expect(requestHostContext({ accountId: "b", spaceId: "s", targets: [] })).rejects.toThrow(
    /account changed/,
  );
  await expect(
    requestHostContext({
      accountId: "a",
      spaceId: "s",
      targets: [],
      paneId: "closed",
      decision: "accept",
    }),
  ).rejects.toThrow(/no longer available/);
  expect(fixture.decide).not.toHaveBeenCalled();
});
it("binds approval to its exact artifact and current source Space", async () => {
  const request = {
    accountId: "a",
    spaceId: "s",
    targets: [],
    paneId: "p",
    decision: "accept" as const,
    artifactId: "artifact-old",
  };
  await expect(requestHostContext(request)).rejects.toThrow(/proposal is no longer/);
  await expect(
    requestHostContext({ ...request, artifactId: "artifact-current", spaceId: "other" }),
  ).rejects.toThrow(/another Space/);
  await requestHostContext({ ...request, artifactId: "artifact-current" });
  expect(fixture.decide).toHaveBeenCalledOnce();
});
