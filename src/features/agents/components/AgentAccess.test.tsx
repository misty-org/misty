import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const appsList = vi.hoisted(() => vi.fn());
vi.mock("../apps/api", () => ({ appsApi: { list: appsList } }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => false }));
vi.mock("@/api/accountEvents", () => ({
  observeAccountChanges: (id: string, _topics: string[], refresh: () => Promise<void>) => {
    if (id) void refresh();
    return () => {};
  },
}));
import { useAgentAccess } from "./AgentAccess";
const app = (id: string, status = "active") => ({
  id,
  app: "gmail",
  name: "Gmail",
  status,
  created_at: "",
});
beforeEach(() => {
  appsList.mockResolvedValue({ available: true, apps: [] });
});
afterEach(() => {
  cleanup();
  appsList.mockReset();
});
it("does not show a previous account’s connections after a late response", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  appsList.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  appsList.mockResolvedValueOnce({ available: true, apps: [app("new")] });
  const { result, rerender } = renderHook(({ id }) => useAgentAccess(id), {
    initialProps: { id: "old" },
  });
  rerender({ id: "new" });
  await waitFor(() => expect(result.current.connections.map((c) => c.id)).toEqual(["new"]));
  await act(async () => resolveOld({ available: true, apps: [app("old")] }));
  expect(result.current.connections.map((c) => c.id)).toEqual(["new"]);
  rerender({ id: "" });
  expect(result.current.connections).toEqual([]);
  expect(result.current.loading).toBe(false);
});
it("retries failed account connections without claiming they are connected", async () => {
  appsList
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ available: true, apps: [] });
  const { result } = renderHook(() => useAgentAccess("owner"));
  await waitFor(() => expect(result.current.connectionsError).toBe(true));
  expect(result.current.connections).toEqual([]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.connectionsError).toBe(false));
  expect(result.current.connections).toEqual([]);
});

it("shows the account's connected apps for every agent", async () => {
  appsList.mockResolvedValue({
    available: true,
    apps: [
      { ...app("ca_1"), alias: "Work" },
      { id: "ca_2", app: "googledrive", name: "Google Drive", status: "pending", created_at: "" },
    ],
  });
  const { result, rerender } = renderHook(({ agent }) => useAgentAccess("owner", agent), {
    initialProps: { agent: "first" },
  });
  await waitFor(() => expect(result.current.connections).toHaveLength(2));
  expect(result.current.connections[0]).toMatchObject({
    name: "Gmail · Work",
    detail: "Connected app",
  });
  expect(result.current.connections[1]).toMatchObject({ detail: "Waiting for sign-in" });
  rerender({ agent: "second" });
  await waitFor(() => expect(result.current.connections).toHaveLength(2));
  expect(appsList).toHaveBeenCalledWith();
});
