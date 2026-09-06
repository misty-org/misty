import { describe, expect, it, vi } from "vitest";
import { createMistyAppSDK, MistyViewStateSchema, MistyWorkspaceUpdateSchema } from "../packages/sdk/src/index.js";

describe("workspace method contracts", () => {
  it("dispatches typed view controls, state and updates through the public SDK", async () => {
    const view = { viewId: "view", panelId: "panel", title: "Code", route: "/apps/code", state: { file: "src/a.ts" }, sidebarVisible: true, active: true, focused: true };
    const request = vi.fn(async ({method}: {method: string}) => method === "workspace.open" ? {viewId:"next"} : method === "workspace.snapshot" ? {revision:1,views:[view]} : null);
    let event!: (value: unknown) => void;
    const sdk = createMistyAppSDK({ request, subscribe: async (_topic, listener) => { event = listener; return () => undefined; } });
    expect(await sdk.workspace.open({ route: "/apps/code", placement: "left", state: { file: "a" }, sidebarVisible: false })).toEqual({viewId:"next"});
    expect(await sdk.workspace.snapshot()).toEqual({revision:1,views:[view]});
    await sdk.workspace.update({ viewId: "view", state: null, title: "New title" });
    await sdk.workspace.focus("view");
    await sdk.workspace.place({ viewId: "view", targetViewId: "next", placement: "up" });
    const changed = vi.fn();
    await sdk.workspace.subscribe(changed); event({revision:1,views:[view]});
    expect(changed).toHaveBeenCalledWith({revision:1,views:[view]});
    expect(() => event({revision:1,views:[{...view, hostSecret:"private"}]})).toThrow();
    await sdk.workspace.close("view");
    expect(request.mock.calls.map(([call]) => call.method).filter(method => method !== "lifecycle.ready")).toEqual(["workspace.open","workspace.snapshot","workspace.update","workspace.focus","workspace.place","workspace.close"]);
  });
  it("rejects cyclic/deep/oversized/non-JSON state and accessors without executing them", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const getter = vi.fn(() => "private");
    let deep: unknown = null; for(let i=0;i<26;i++) deep = {nested:deep};
    for(const value of [cyclic, deep, "x".repeat(65537), {bad:NaN}, {bad:undefined}, new Date(), {bad:()=>undefined}, new Array(2)]) expect(MistyViewStateSchema.safeParse(value).success).toBe(false);
    expect(MistyViewStateSchema.safeParse(Object.defineProperty({}, "value", {enumerable:true,get:getter})).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const shared = { value: "same object, two JSON values" };
    expect(MistyViewStateSchema.parse({ a: shared, b: shared })).toEqual({ a: shared, b: shared });
    expect(MistyViewStateSchema.parse({ a: [null, true, 1, "日本語"] })).toEqual({a:[null,true,1,"日本語"]});
  });
  it("requires an actual update and validates controls before transport dispatch", async () => {
    expect(MistyWorkspaceUpdateSchema.safeParse({viewId:"view"}).success).toBe(false);
    const request = vi.fn(async()=>null), sdk = createMistyAppSDK({request});
    await expect(sdk.workspace.focus("")).rejects.toThrow();
    await expect(sdk.workspace.update({viewId:"view", title:"bad\nlabel"})).rejects.toThrow();
    await expect(sdk.workspace.open({route:"/settings"})).rejects.toThrow();
    expect(request.mock.calls).toHaveLength(1); // Lifecycle handshake only.
  });
});
