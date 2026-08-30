import { connectionsApi } from "@/api/connections";
import {
  figmaDrawingsApi,
  type FigmaBinding,
  type FigmaBindingContext,
} from "@/api/integrations/figma";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFigmaDrawingsStore } from "./useFigmaDrawingsStore";

vi.mock("@/api/connections", () => ({
  connectionsApi: { list: vi.fn(), remove: vi.fn() },
}));
vi.mock("@/api/integrations/figma", () => ({
  figmaDrawingsApi: {
    bindings: vi.fn(),
    records: vi.fn(),
    sync: vi.fn(),
    context: vi.fn(),
    comment: vi.fn(),
    reconcileWebhooks: vi.fn(),
  },
}));

describe("useFigmaDrawingsStore", () => {
  beforeEach(() => {
    useFigmaDrawingsStore.getState().reset();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("isolates record failures and never lets a stale account scope overwrite the current one", async () => {
    const firstConnections = deferred<{ connections: never[] }>();
    const firstBindings = deferred<{ bindings: FigmaBinding[] }>();
    vi.mocked(connectionsApi.list)
      .mockReturnValueOnce(firstConnections.promise)
      .mockResolvedValueOnce({ connections: [] });
    vi.mocked(figmaDrawingsApi.bindings)
      .mockReturnValueOnce(firstBindings.promise)
      .mockResolvedValueOnce({ bindings: [binding("current")] });
    vi.mocked(figmaDrawingsApi.records).mockRejectedValue(new Error("one provider failed"));

    const stale = useFigmaDrawingsStore.getState().load("account-a", "space-a");
    await useFigmaDrawingsStore.getState().load("account-b", "space-b");
    firstConnections.resolve({ connections: [] });
    firstBindings.resolve({ bindings: [binding("stale")] });
    await stale;

    expect(useFigmaDrawingsStore.getState().scopeKey).toBe("account-b:space-b");
    expect(useFigmaDrawingsStore.getState().bindings[0]?.id).toBe("current");
    expect(useFigmaDrawingsStore.getState().error).toBe("");
    expect(localStorage.getItem("misty:figma-drawings")).toBeNull();
  });

  it("waits for sync before reading records so refreshed context cannot remain stale", async () => {
    const sync = deferred<{ binding: FigmaBinding; records_synced: number }>();
    vi.mocked(figmaDrawingsApi.sync).mockReturnValue(sync.promise);
    vi.mocked(figmaDrawingsApi.records).mockResolvedValue({ records: [] });
    useFigmaDrawingsStore.setState({ bindings: [binding("binding-1")] });

    const request = useFigmaDrawingsStore.getState().sync("space-1", "binding-1");
    await Promise.resolve();
    expect(figmaDrawingsApi.records).not.toHaveBeenCalled();
    sync.resolve({ binding: binding("binding-1"), records_synced: 1 });
    await request;

    expect(figmaDrawingsApi.records).toHaveBeenCalledWith("space-1", "binding-1");
  });

  it("keeps the caller's one-time comment key stable at the API boundary", async () => {
    vi.mocked(figmaDrawingsApi.comment).mockResolvedValue({ comment: context.comments[0] });
    vi.mocked(figmaDrawingsApi.context).mockResolvedValue(context);

    await useFigmaDrawingsStore
      .getState()
      .comment("space-1", "binding-1", "file-1", "Ship it", "node-1", "review-once-1");

    expect(figmaDrawingsApi.comment).toHaveBeenCalledWith("space-1", "binding-1", {
      file_key: "file-1",
      message: "Ship it",
      node_id: "node-1",
      confirmed: true,
      idempotency_key: "review-once-1",
    });
  });

  it("reconciles live sync only through the explicit webhook action and resets account scope", async () => {
    vi.mocked(figmaDrawingsApi.reconcileWebhooks).mockResolvedValue({
      binding: binding("binding-1"),
      subscriptions: [
        {
          id: "subscription-1",
          binding_id: "binding-1",
          webhook_id: "webhook-1",
          event_type: "FILE_UPDATE",
          status: "active",
        },
      ],
    });
    useFigmaDrawingsStore.setState({
      scopeKey: "account-1:space-1",
      bindings: [binding("binding-1")],
    });

    expect(figmaDrawingsApi.reconcileWebhooks).not.toHaveBeenCalled();
    await useFigmaDrawingsStore.getState().reconcileWebhooks("space-1", "binding-1");
    expect(figmaDrawingsApi.reconcileWebhooks).toHaveBeenCalledWith("space-1", "binding-1");
    expect(useFigmaDrawingsStore.getState().liveSyncByBinding["binding-1"]).toBe(1);

    useFigmaDrawingsStore.getState().reset();
    expect(useFigmaDrawingsStore.getState().scopeKey).toBe("");
    expect(useFigmaDrawingsStore.getState().bindings).toEqual([]);
    expect(useFigmaDrawingsStore.getState().liveSyncByBinding).toEqual({});
  });
});

const context: FigmaBindingContext = {
  file: {
    key: "file-1",
    name: "Launch",
    version: "1",
    last_modified: "2026-08-19T00:00:00Z",
    editor_type: "figma",
  },
  versions: [],
  comments: [{ id: "comment-1", message: "Done", created_at: "2026-08-19T00:00:00Z" }],
};

function binding(id: string): FigmaBinding {
  return {
    id,
    space_id: "space-1",
    connection_id: "connection-1",
    integration_id: "integration-1",
    shared_resource_id: "resource-1",
    bound_by_user_id: "user-1",
    resource_type: "file",
    external_id: "file-1",
    display_name: "Launch",
    file_key: "file-1",
    status: "active",
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
