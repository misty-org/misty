import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AiPaneHost, aiContextBoundary, useAiSurfaceAdapter } from "./AiPaneHost";
import { useAiSurfaceStore } from "./store";
import { aiSurfaceApi } from "./api";
import type { AiSurfaceAdapter } from "./types";
import { createAppRpcScope } from "../apps/rpc/session";
import { createAppSurfaceBridge } from "../apps/rpc/surface";

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "surface-account" } }) }));
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.restoreAllMocks();
});

it("replaces same-kind component callbacks and unregisters their latest version on unmount", async () => {
  vi.spyOn(aiSurfaceApi, "settings").mockRejectedValue(
    new Error("No proactive service in fixture"),
  );
  useAiSurfaceStore.setState({
    registrations: {},
    sessions: {},
    companion: { phase: "home", completedCount: 0 },
  });
  const scope = createAppRpcScope({
    identity: {
      appId: "journal",
      accountId: "surface-account",
      spaceId: "space-a",
      instanceId: "view-a",
    },
    scopes: ["ai.use"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  let published: AiSurfaceAdapter | null = null;
  const bridge = createAppSurfaceBridge(scope, (next) => {
    published = next;
  });
  cleanups.push(() => {
    bridge.close();
    scope.close();
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  function Child({ adapter }: { adapter: AiSurfaceAdapter | null }) {
    useAiSurfaceAdapter(adapter);
    return null;
  }
  const render = (adapter: AiSurfaceAdapter | null, child = true) =>
    act(() =>
      root.render(
        <AiPaneHost paneId="surface-pane">{child && <Child adapter={adapter} />}</AiPaneHost>,
      ),
    );
  const source = (id: string): AiSurfaceAdapter => ({
    surfaceId: "notes",
    label: "Notes",
    getContext: () => [{ kind: "note", id, title: id, privacy: "shared", spaceId: "space-a" }],
    getSuggestedActions: () => [{ id, label: id, prompt: id }],
  });
  await bridge.register(source("first"));
  const first = published!;
  render(first);
  expect(useAiSurfaceStore.getState().registrations["surface-account:surface-pane"].adapter).toBe(
    first,
  );
  await bridge.register(source("second"));
  const second = published!;
  expect(() => first.getContext()).toThrow("closed");
  expect(aiContextBoundary(first)).toBe("none");
  // An unrelated parent render can occur while the host still holds the old
  // React state. Both optional reads must tolerate that revoked capability.
  render(first);
  render(second);
  expect(useAiSurfaceStore.getState().registrations["surface-account:surface-pane"].adapter).toBe(
    second,
  );
  render(null, false);
  expect(
    useAiSurfaceStore.getState().registrations["surface-account:surface-pane"],
  ).toBeUndefined();
});
