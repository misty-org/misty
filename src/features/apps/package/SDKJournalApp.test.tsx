import { act } from "react";
import { fireEvent, within, waitFor } from "@testing-library/react";
import {
  createMistyAppSDK,
  type MistyComponentMount,
  type MistyComponentContext,
} from "@misty/sdk";
import { expect, it, vi } from "vitest";
import definition from "./SDKJournalApp";

it("mounts both Journal sections using the public SDK, preserves editor routes and releases every lease on unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = document.createElement("div");
  document.body.append(root);
  const abort = new AbortController();
  const subscriptions = new Map<string, Set<(event: unknown) => void>>();
  const drawing = {
    id: "drawing-a",
    space_id: "space-a",
    creator_user_id: "user-a",
    title: "SDK canvas",
    lifecycle_state: "active",
    collaboration_revision: 0,
    acl_version: 1,
    created_at: "2026-09-05T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
    role: "creator",
    can_delete: true,
    audience_kind: "space",
  };
  const drawings: (typeof drawing)[] = [];
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "context.get")
      return {
        appId: "journal",
        user: { id: "user-a" },
        space: { id: "space-a", name: "Product" },
      };
    if (message.method === "spaces.members.list") return { members: [], agents: [] };
    if (message.method === "notes.list") return { notes: [] };
    if (message.method === "drawings.list") return { drawings: [...drawings] };
    if (message.method === "drawings.create") {
      drawings.push(drawing);
      return drawing;
    }
    if (message.method === "collaboration.open")
      return { handle: crypto.randomUUID(), role: "creator" };
    if (message.method === "ai.snapshot") return { available: false, following: false };
    return undefined;
  });
  const registerSurface = vi.fn(async () => () => {});
  const misty = createMistyAppSDK({
    request,
    registerSurface,
    subscribe: async (topic, listener) => {
      const listeners = subscriptions.get(topic) ?? new Set();
      subscriptions.set(topic, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) subscriptions.delete(topic);
      };
    },
  });
  const context: MistyComponentContext = {
    instanceId: "journal-a",
    route: "/apps/journal?space=space-a&view=notes",
    active: true,
    appearance: { mode: "dark" },
  };
  let mounted: MistyComponentMount | undefined;
  try {
    await act(async () => {
      mounted = await definition.mount({ root, misty, context, signal: abort.signal });
    });
    await waitFor(() =>
      expect(request.mock.calls.some(([message]) => message.method === "notes.list")).toBe(true),
    );
    await act(async () =>
      mounted!.update({ ...context, route: "/apps/journal?space=space-a&view=drawings" }),
    );
    await within(root).findByText("Sketch ideas together");
    fireEvent.click(within(root).getByRole("button", { name: /^New$/ }));
    const dialog = within(document.body).getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "SDK canvas" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create drawing" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        method: "drawings.create",
        params: { body: { title: "SDK canvas" } },
      }),
    );
    await waitFor(() =>
      expect(
        request.mock.calls
          .filter(([message]) => message.method === "navigation.open")
          .map(([message]) => (message.params as { route: string }).route),
      ).toEqual(expect.arrayContaining([expect.stringContaining("drawingView=canvas")])),
    );
    await waitFor(() =>
      expect(
        request.mock.calls.filter(([message]) => message.method === "collaboration.open"),
      ).toHaveLength(1),
    );
    expect(registerSurface).toHaveBeenCalled();
    expect(root.querySelector("iframe")).toBeNull();
    expect(
      request.mock.calls.filter(([message]) => message.method === "activity.report"),
    ).toHaveLength(0);
  } finally {
    await act(async () => {
      await mounted?.unmount();
      abort.abort();
    });
    root.remove();
    vi.unstubAllGlobals();
  }
  await waitFor(() => expect(subscriptions.size).toBe(0));
  expect(
    request.mock.calls.filter(([message]) => message.method === "collaboration.close"),
  ).toHaveLength(1);
});
