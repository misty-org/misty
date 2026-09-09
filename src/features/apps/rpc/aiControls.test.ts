import {
  createMistyAppSDK,
  type MistySurfaceAdapter,
  type MistyAiControlsSnapshot,
} from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createAiControlsRpc } from "./aiControls";
import { createAiControlsBackend } from "./aiControlsBackend";
import { createAppRpcScope } from "./session";
import { createAppSurfaceBridge } from "./surface";

const stores = vi.hoisted(() => ({
  ai: {} as Record<string, unknown>,
  workspace: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
}));
vi.mock("@/features/ai-surface/store", () => ({
  useAiSurfaceStore: {
    getState: () => stores.ai,
    subscribe: (listener: () => void) => {
      stores.listeners.add(listener);
      return () => stores.listeners.delete(listener);
    },
  },
}));
vi.mock("@/features/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => stores.workspace,
    subscribe: (listener: () => void) => {
      stores.listeners.add(listener);
      return () => stores.listeners.delete(listener);
    },
  },
}));
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  stores.listeners.clear();
});
async function fixture(grants = ["ai.use"]) {
  let account = "account-a";
  const scope = createAppRpcScope({
    identity: { appId: "journal", accountId: account, spaceId: "space-a", instanceId: "tab-a" },
    scopes: grants,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: (id) => id === account,
  });
  const bridge = createAppSurfaceBridge(scope, () => {});
  const source: MistySurfaceAdapter = {
    surfaceId: "notes",
    label: "Note",
    getContext: () => [
      { kind: "note", id: "note-a", spaceId: "space-a", title: "Note", privacy: "shared" },
    ],
    getSelection: () => ({
      kind: "text",
      content: "selected",
      contentHash: "hash-a",
      object: { kind: "note", id: "note-a", spaceId: "space-a" },
    }),
    getSuggestedActions: () => [
      {
        id: "notes.improve",
        label: "Improve",
        prompt: "Improve this selection",
        trigger: "selection",
      },
    ],
    canApply: vi.fn(() => true),
    applyArtifact: vi.fn(async () => {}),
  };
  if (grants.includes("ai.use")) await bridge.register(source);
  const pane = {
    type: "leaf",
    id: "pane-a",
    activeTabId: "tab-a",
    tabs: [{ id: "tab-a", groupKey: "app:journal" }],
  };
  stores.workspace = { layout: { root: pane } };
  const artifact = {
    id: "proposal-a",
    kind: "text_patch",
    state: "proposed",
    expiresAt: "2099-01-01T00:00:00Z",
    target: { kind: "note", id: "note-a", spaceId: "space-a" },
    operations: { replacement: "Improved text", privateExtra: "not-exposed" },
    sources: [{ href: "private-url" }],
  };
  const companion = {
    accountId: "account-a",
    paneId: "pane-a",
    phase: "following",
    approval: { artifact },
  };
  const follow = vi.fn(),
    submit = vi.fn(async () => {}),
    decideArtifact = vi.fn(async () => {});
  const registrations = {
    "account-a:pane-a": { accountId: "account-a", paneId: "pane-a", adapter: bridge.read() },
  };
  stores.ai = {
    companion,
    registrations,
    follow,
    submit,
    decideArtifact,
    sessions: { privateCredentials: "never expose" },
  };
  const rpc = createAiControlsRpc(scope, createAiControlsBackend(scope, bridge.read));
  const sdk = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message),
    subscribe: rpc.subscribe,
  });
  cleanup.push(() => {
    scope.close();
    rpc.close();
    bridge.close();
  });
  return {
    scope,
    sdk,
    bridge,
    source,
    pane,
    registrations,
    companion,
    artifact,
    follow,
    submit,
    decideArtifact,
    switchAccount: () => {
      account = "other";
    },
  };
}
it("exposes only the owning view's proposal and invokes its registered action with a current selection", async () => {
  const f = await fixture();
  expect(await f.sdk.ai.snapshot()).toEqual({
    available: true,
    following: true,
    proposal: {
      id: "proposal-a",
      kind: "text_patch",
      state: "proposed",
      stale: false,
      replacement: "Improved text",
    },
  });
  await f.sdk.ai.runAction("notes.improve", "hash-a");
  expect(f.submit).toHaveBeenCalledWith(
    "account-a",
    "pane-a",
    f.bridge.read(),
    expect.objectContaining({ id: "notes.improve" }),
  );
  await expect(f.sdk.ai.runAction("invented", "hash-a")).rejects.toMatchObject({
    code: "action_unavailable",
  });
  await expect(f.sdk.ai.runAction("notes.improve", "old-hash")).rejects.toMatchObject({
    code: "selection_changed",
  });
  expect(f.submit).toHaveBeenCalledOnce();
  await f.sdk.ai.decideProposal("proposal-a", "accept");
  expect(f.decideArtifact).toHaveBeenCalledWith(
    "account-a",
    "pane-a",
    f.bridge.read(),
    f.artifact,
    "accept",
  );
});
it("does not reveal another account, pane, document or Space proposal", async () => {
  const f = await fixture();
  f.companion.accountId = "other";
  expect((await f.sdk.ai.snapshot()).proposal).toBeUndefined();
  f.companion.accountId = "account-a";
  f.companion.paneId = "other";
  expect((await f.sdk.ai.snapshot()).proposal).toBeUndefined();
  f.companion.paneId = "pane-a";
  f.artifact.target.id = "other";
  expect((await f.sdk.ai.snapshot()).proposal).toBeUndefined();
  f.artifact.target.id = "note-a";
  f.artifact.target.spaceId = "other";
  expect((await f.sdk.ai.snapshot()).proposal).toBeUndefined();
  await expect(f.sdk.ai.decideProposal("proposal-a", "reject")).rejects.toMatchObject({
    code: "proposal_unavailable",
  });
  expect(f.decideArtifact).not.toHaveBeenCalled();
});
it("denies background tabs, changed registrations, missing permissions and stale acceptance", async () => {
  const f = await fixture();
  f.pane.activeTabId = "other";
  expect(await f.sdk.ai.snapshot()).toEqual({ available: false, following: false });
  await expect(f.sdk.ai.runAction("notes.improve")).rejects.toMatchObject({
    code: "surface_inactive",
  });
  f.pane.activeTabId = "tab-a";
  f.registrations["account-a:pane-a"].adapter = null;
  await expect(f.sdk.ai.runAction("notes.improve")).rejects.toMatchObject({
    code: "surface_inactive",
  });
  f.registrations["account-a:pane-a"].adapter = f.bridge.read();
  f.artifact.expiresAt = "2000-01-01T00:00:00Z";
  expect((await f.sdk.ai.snapshot()).proposal?.stale).toBe(true);
  await expect(f.sdk.ai.decideProposal("proposal-a", "accept")).rejects.toMatchObject({
    code: "proposal_stale",
  });
  await f.sdk.ai.decideProposal("proposal-a", "reject");
  expect(f.decideArtifact).toHaveBeenCalledOnce();
  const denied = await fixture([]);
  await expect(denied.sdk.ai.snapshot()).rejects.toMatchObject({ code: "capability_denied" });
  expect(denied.submit).not.toHaveBeenCalled();
});
it("deduplicates view snapshots, removes failing listeners and stops notifications on account change", async () => {
  const f = await fixture();
  const listener = vi.fn<(snapshot: MistyAiControlsSnapshot) => void>();
  await f.sdk.ai.subscribe(listener);
  stores.listeners.forEach((emit) => emit());
  expect(listener).toHaveBeenCalledOnce();
  f.artifact.operations.replacement = "Different text";
  stores.listeners.forEach((emit) => emit());
  expect(listener).toHaveBeenCalledTimes(2);
  const broken = vi.fn(() => {
    throw new Error("bad component callback");
  });
  await expect(f.sdk.ai.subscribe(broken)).resolves.toBeTypeOf("function");
  expect(broken).toHaveBeenCalledOnce();
  f.switchAccount();
  stores.listeners.forEach((emit) => emit());
  expect(listener).toHaveBeenCalledTimes(2);
  expect(stores.listeners.size).toBe(0);
});
