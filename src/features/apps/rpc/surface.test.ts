import type { MistyAiArtifact, MistySurfaceAdapter } from "@misty/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAppRpcScope } from "./session";
import { createAppSurfaceBridge } from "./surface";

function fixture(grants = ["ai.use"]) {
  const scope = createAppRpcScope({
    identity: { appId: "terminal", accountId: "a", spaceId: "s", instanceId: "t" },
    scopes: grants,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: () => true,
  });
  let published: MistySurfaceAdapter | null = null;
  const bridge = createAppSurfaceBridge(scope, (value) => {
    published = value;
  });
  const adapter: MistySurfaceAdapter = {
    surfaceId: "terminal",
    label: "Terminal",
    getContext: () => [
      { id: "session", kind: "terminal.session", title: "Shell", privacy: "device" },
    ],
    canApply: () => true,
    applyArtifact: vi.fn(async () => {}),
  };
  return { scope, bridge, adapter, read: () => published };
}
describe("SDK component AI capability", () => {
  it("keeps citation and undo callbacks behind the registered view lifetime", async () => {
    const f = fixture();
    const undo = vi.fn(async (_artifact: MistyAiArtifact) => {}),
      citation = vi.fn();
    await f.bridge.register({ ...f.adapter, undoArtifact: undo, openCitation: citation });
    const active = f.bridge.read()!;
    const artifact = {
      id: "artifact",
      target: { kind: "note", id: "note-a", spaceId: "s" },
    } as MistyAiArtifact;
    await active.undoArtifact!(artifact);
    expect(undo.mock.calls[0][0]).not.toBe(artifact);
    active.openCitation!({
      id: "citation",
      kind: "note",
      title: "Note",
      href: "https://example.com",
    });
    expect(citation).toHaveBeenCalledOnce();
    f.scope.close();
    expect(f.bridge.read()).toBeNull();
    await expect(active.undoArtifact!(artifact)).rejects.toMatchObject({ code: "app_closed" });
    expect(() =>
      active.openCitation!({
        id: "citation",
        kind: "note",
        title: "Note",
        href: "https://example.com",
      }),
    ).toThrow("closed");
    expect(undo).toHaveBeenCalledOnce();
  });
  it("notifies only the mounted App after an artifact is applied", async () => {
    const f = fixture();
    const applied = vi.fn();
    await f.bridge.register({ ...f.adapter, onArtifactApplied: applied });
    const surface = f.read()!;
    const artifact = {
      target: { spaceId: "s" },
      kind: "task_set",
      state: "applied",
    } as MistyAiArtifact;
    await surface.onArtifactApplied!(artifact);
    expect(applied).toHaveBeenCalledOnce();
    expect(applied.mock.calls[0][0]).not.toBe(artifact);
    await expect(
      surface.onArtifactApplied!({
        ...artifact,
        target: { kind: "task", id: "task-a", spaceId: "other" },
      }),
    ).rejects.toMatchObject({ code: "space_mismatch" });
    f.scope.close();
    await expect(surface.onArtifactApplied!(artifact)).rejects.toMatchObject({
      code: "app_closed",
    });
    expect(applied).toHaveBeenCalledOnce();
  });
  it("keeps registration lifetime and data scoped, without passing host stores", async () => {
    const f = fixture();
    const remove = await f.bridge.register(f.adapter);
    const first = f.read()!;
    const context = first.getContext();
    context[0].id = "edited";
    expect(first.getContext()[0].id).toBe("session");
    await f.bridge.register({ ...f.adapter, label: "Another shell" });
    remove();
    expect(f.read()?.label).toBe("Another shell");
    expect(() => first.getContext()).toThrow(/closed/);
    const current = f.read()!;
    f.scope.close();
    expect(f.read()).toBeNull();
    expect(() => current.getContext()).toThrow(/closed/);
  });
  it("denies ungranted, foreign-surface and cross-Space context or artifact access", async () => {
    const denied = fixture([]);
    await expect(denied.bridge.register(denied.adapter)).rejects.toMatchObject({
      code: "capability_denied",
    });
    denied.scope.close();
    const f = fixture();
    await expect(f.bridge.register({ ...f.adapter, surfaceId: "settings" })).rejects.toMatchObject({
      code: "invalid_surface",
    });
    await f.bridge.register({
      ...f.adapter,
      getContext: () => [
        { id: "other", kind: "note", title: "other", privacy: "shared", spaceId: "elsewhere" },
      ],
    });
    expect(() => f.read()!.getContext()).toThrow(/different Space/);
    await f.bridge.register(f.adapter);
    const artifact = {
      target: { spaceId: "elsewhere" },
      expiresAt: "2099-01-01T00:00:00Z",
    } as MistyAiArtifact;
    expect(f.read()!.canApply!(artifact)).toBe(false);
    await expect(f.read()!.applyArtifact!(artifact)).rejects.toMatchObject({
      code: "space_mismatch",
    });
    expect(f.adapter.applyArtifact).not.toHaveBeenCalled();
    f.scope.close();
  });
});
