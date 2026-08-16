import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn());
const appsList = vi.hoisted(() => vi.fn());
vi.mock("../apps/api", () => ({ appsApi: { list: appsList } }));
vi.mock("../mcp/api", () => ({ mcpConnectionsApi: { list } }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => false }));
vi.mock("@/api/accountEvents", () => ({
  observeAccountChanges: (id: string, _topics: string[], refresh: () => Promise<void>) => {
    if (id) void refresh();
    return () => {};
  },
}));
import { useAgentAccess } from "./AgentAccess";
beforeEach(() => {
  appsList.mockResolvedValue({ available: true, apps: [] });
});
afterEach(() => {
  cleanup();
  list.mockReset();
  appsList.mockReset();
});
it("does not show a previous account’s connections after a late response", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  list.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  list.mockResolvedValueOnce({
    connections: [
      { id: "new", status: "active" },
      { id: "revoked", status: "revoked" },
    ],
  });
  const { result, rerender } = renderHook(({ id }) => useAgentAccess(id), {
    initialProps: { id: "old" },
  });
  rerender({ id: "new" });
  await waitFor(() => expect(result.current.connections.map((c) => c.id)).toEqual(["new"]));
  await act(async () => resolveOld({ connections: [{ id: "old", status: "active" }] }));
  expect(result.current.connections.map((c) => c.id)).toEqual(["new"]);
  rerender({ id: "" });
  expect(result.current.connections).toEqual([]);
  expect(result.current.loading).toBe(false);
});
it("retries failed account connections without claiming they are connected", async () => {
  list.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ connections: [] });
  const { result } = renderHook(() => useAgentAccess("owner"));
  await waitFor(() => expect(result.current.connectionsError).toBe(true));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.connectionsError).toBe(false));
  expect(result.current.connections).toEqual([]);
});

it("shows the account's connected apps for every agent", async () => {
  list.mockResolvedValue({ connections: [] });
  appsList.mockResolvedValue({
    available: true,
    apps: [
      { id: "ca_1", app: "gmail", name: "Gmail", alias: "Work", status: "active", created_at: "" },
      { id: "ca_2", app: "googledrive", name: "Google Drive", status: "pending", created_at: "" },
    ],
  });
  const { result, rerender } = renderHook(({ agent }) => useAgentAccess("owner", agent), {
    initialProps: { agent: "first" },
  });
  await waitFor(() => expect(result.current.connections).toHaveLength(2));
  expect(result.current.connections[0]).toMatchObject({
    name: "Gmail · Work",
    source: "apps",
    detail: "Connected app",
  });
  expect(result.current.connections[1]).toMatchObject({ detail: "Waiting for sign-in" });
  rerender({ agent: "second" });
  await waitFor(() => expect(result.current.connections).toHaveLength(2));
  expect(appsList).toHaveBeenCalledWith();
});
it("keeps connected apps when the MCP connection service fails", async () => {
  list.mockRejectedValue(new Error("offline"));
  appsList.mockResolvedValue({
    available: true,
    apps: [{ id: "ca_1", app: "gmail", name: "Gmail", status: "active", created_at: "" }],
  });
  const { result } = renderHook(() => useAgentAccess("owner", "agent"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.connectionsError).toBe(true);
  expect(result.current.connections[0]).toMatchObject({ source: "apps", detail: "Connected app" });
});
