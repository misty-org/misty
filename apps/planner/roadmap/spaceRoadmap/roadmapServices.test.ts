import { createMistyAppSDK, type SpaceRoadmapSnapshot } from "@misty/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAppRpcScope } from "@/features/apps/rpc/session";
import { createServerRpc } from "@/features/apps/rpc/server";
import { createSDKRoadmapServices } from "./roadmapServices";
import { sdkRoadmapSnapshot } from "./sdkRoadmapValues";
import { isPlannerConflict } from "./roadmapRuntime";

const snapshot: SpaceRoadmapSnapshot = {
  roadmap: { id: "map-a", space_id: "space-a", name: "Launch", description: "", graph_version: 5, created_by_user_id: "user-a", audience_kind: "space", archived_at: null, created_at: "2026-09-05T00:00:00Z", updated_at: "2026-09-05T00:00:00Z" },
  milestones: null, goals: null, nodes: null, node_definitions: null, edges: null,
  goal_total: 0, goal_done: 0, milestone_total: 0, milestone_done: 0, progress_percentage: 0,
};

describe("Planner roadmap SDK adapter", () => {
  it("normalizes an empty graph and keeps explicit layout and archive versions", async () => {
    const request = vi.fn(async ({ method }: { method: string; params?: unknown }) => {
      if (method === "lifecycle.ready") return;
      if (method === "roadmaps.get") return snapshot;
      return { graph_version: 6 };
    });
    const api = createSDKRoadmapServices(createMistyAppSDK({ request }));
    const graph = await api.roadmap("space-a", "map-a");
    expect(graph).toMatchObject({ milestones: [], goals: [], nodes: [], edges: [], node_definitions: [], roadmap: { archived_at: undefined } });
    await api.updateRoadmapLayout("space-a", "map-a", { milestones: [], goals: [], nodes: [] }, 5);
    await api.archiveRoadmap("space-a", graph.roadmap);
    expect(request.mock.calls.find(([call]) => call.method === "roadmaps.layout.update")?.[0]).toMatchObject({ params: { body: { expected_version: 5 } } });
    expect(request.mock.calls.find(([call]) => call.method === "roadmaps.delete")?.[0]).toMatchObject({ params: { query: { expected_version: 5 } } });
  });
  it("keeps stale-version failures recognizable by optimistic save recovery", async () => {
    const scope = createAppRpcScope({ identity: { appId: "planner", accountId: "user-a", spaceId: "space-a", instanceId: "tab-a" }, scopes: ["roadmaps.write"], expiresAt: "2099-01-01T00:00:00Z", isCurrentAccount: () => true });
    const rpc = createServerRpc(scope, { serverBase: "https://fixture.example/v1", readAppSession: () => ({ appId: "planner", spaceId: "space-a", token: "host-only" }), fetch: async () => new Response(JSON.stringify({ code: "version_conflict" }), { status: 409 }) });
    const sdk = createMistyAppSDK({ request: (message) => message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message) });
    try {
      await createSDKRoadmapServices(sdk).updateRoadmap("space-a", sdkRoadmapSnapshot(snapshot).roadmap);
      throw new Error("The stale version unexpectedly succeeded");
    } catch (error) {
      expect(isPlannerConflict(error)).toBe(true);
    } finally { scope.close(); }
  });
  it("rejects invalid node drafts before transport", async () => {
    const request = vi.fn(async () => undefined);
    const api = createSDKRoadmapServices(createMistyAppSDK({ request }));
    await expect(api.createRoadmapNode("space-a", "map-a", {}, 5)).rejects.toMatchObject({ code: "invalid_params" });
    await expect(api.createRoadmapNode("space-a", "map-a", { title: "Risk" }, 0)).rejects.toMatchObject({ code: "invalid_params" });
    expect(request).toHaveBeenCalledTimes(1); // SDK readiness only.
  });
});
