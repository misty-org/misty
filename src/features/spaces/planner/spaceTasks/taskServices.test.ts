import { createMistyAppSDK, type SpaceTask as SDKTask } from "@misty/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAppRpcScope } from "@/features/apps/rpc/session";
import { createServerRpc } from "@/features/apps/rpc/server";
import { createSDKTaskServices, plannerTask } from "./taskServices";

const task: SDKTask = {
  id: "task-a",
  space_id: "space-a",
  task_number: 1,
  task_key: "TASK-1",
  title: "Ship Planner",
  notes: "",
  status: "todo",
  priority: "medium",
  rank: 1,
  due_timezone: "UTC",
  due_at: null,
  completed_at: null,
  archived_at: null,
  source_refs: null,
  audience_kind: "space",
  version: 7,
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
};

function fixture() {
  const scope = createAppRpcScope({
    identity: { appId: "planner", accountId: "account-a", spaceId: "space-a", instanceId: "tab-a" },
    scopes: ["tasks.read", "tasks.write"],
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: () => true,
  });
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify(
        method === "tasks.list"
          ? { tasks: [task], status_totals: null, next_cursor: "next" }
          : method === "tasks.move"
            ? { task: { ...task, status: "done", version: 8 }, reordered: null }
            : task,
      ),
    );
  });
  const rpc = createServerRpc(scope, {
    serverBase: "https://server.example/v1",
    readAppSession: () => ({ appId: "planner", spaceId: "space-a", token: "host-only" }),
    fetch: fetcher,
  });
  const sdk = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message),
  });
  return { scope, fetcher, api: createSDKTaskServices(sdk) };
}

describe("Planner task SDK adapter", () => {
  it("uses named RPC methods and preserves pagination, versions and nullable responses", async () => {
    const f = fixture();
    try {
      const page = await f.api.tasks("space-a", {
        assigneeAgentId: "agent-a",
        cursor: "previous",
        limit: 200,
      });
      expect(page.tasks[0]).toMatchObject({ source_refs: [], due_at: undefined, version: 7 });
      expect(page.status_totals).toEqual({ todo: 0, in_progress: 0, done: 0, canceled: 0 });
      expect(page.next_cursor).toBe("next");
      await f.api.updateTask("space-a", page.tasks[0], { title: "Updated" });
      const moved = await f.api.moveTask("space-a", page.tasks[0], "done");
      expect(moved).toMatchObject({ task: { status: "done", version: 8 }, reordered: [] });
      await f.api.archiveTask("space-a", page.tasks[0]);
      const envelopes = f.fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
      expect(envelopes.map((item) => item.method)).toEqual([
        "tasks.list",
        "tasks.update",
        "tasks.move",
        "tasks.delete",
      ]);
      expect(envelopes[0].params.query).toEqual({
        assignee_agent_id: "agent-a",
        cursor: "previous",
        limit: 200,
      });
      expect(envelopes[1].params.body).toMatchObject({ title: "Updated", version: 7 });
      expect(envelopes[3].params.query).toEqual({ version: 7 });
    } finally {
      f.scope.close();
    }
  });
  it("rejects another Space and closed views before any HTTP request", async () => {
    const f = fixture();
    await expect(f.api.tasks("space-b")).rejects.toMatchObject({ code: "space_mismatch" });
    f.scope.close();
    await expect(f.api.tasks("space-a")).rejects.toMatchObject({ code: "app_closed" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed task enums and attachments instead of corrupting board state", () => {
    expect(() => plannerTask({ ...task, status: "unknown" })).toThrow();
    expect(() =>
      plannerTask({ ...task, source_refs: [{ kind: "task_attachment", resource_id: 42 }] }),
    ).toThrow();
    expect(
      plannerTask({
        ...task,
        source_refs: [
          { kind: "task_attachment", resource_id: "attachment-a", display_name: "Spec" },
        ],
      }).source_refs[0],
    ).toMatchObject({ resource_id: "attachment-a" });
  });
});
