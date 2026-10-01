import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn());
vi.mock("../mcp/api", () => ({ mcpConnectionsApi: { list } }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => false }));
vi.mock("@/api/accountEvents", () => ({
  observeAccountChanges: (id: string, _topics: string[], refresh: () => Promise<void>) => {
    if (id) void refresh();
    return () => {};
  },
}));
import { useAgentAccess } from "./AgentAccess";
afterEach(() => {
  cleanup();
  list.mockReset();
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
