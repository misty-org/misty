import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapabilitiesSDK, createServerSDK } from "@misty/sdk";
const sdk = (request: (message: { method: string; params?: unknown }) => Promise<any>) => createCapabilitiesSDK(createServerSDK((method, params) => request({method, params})));
const requestId = crypto.randomUUID();
const runId = crypto.randomUUID();
const success = { requestId, state: "completed", outcome: { status: "success", result: { recorded: true }, evidence: [], partial: false } };
const invocation = () => ({ requestId, capability: "habits.record", capabilityVersion: 1, providerId: "example.habits/backend", providerVersion: 1, targetId: crypto.randomUUID(), targetRevision: 1, input: {}, deadline: new Date(Date.now()+60_000).toISOString() });
afterEach(() => vi.useRealTimers());
describe("capability execution helpers", () => {
  it("polls the same request and returns a verified outcome", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce({requestId,runId}).mockResolvedValueOnce({requestId,state:"running",outcome:null}).mockResolvedValueOnce(success);
    const pending = sdk(request).invokeAndWait(invocation());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(success);
    expect(request.mock.calls.slice(1).every(([call]) => call.params.path.requestID===requestId)).toBe(true);
  });
  it("returns an approval wait without approving or continuing automatically", async () => {
    const waiting = {requestId,state:"waiting",outcome:{status:"approval_required",waitId:crypto.randomUUID(),approvalId:crypto.randomUUID(),expiresAt:new Date(Date.now()+60_000).toISOString(),reason:"Review this write"}};
    const request=vi.fn().mockResolvedValue(waiting);
    expect(await sdk(request).waitForResult(requestId)).toEqual(waiting);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requests cancellation when abort overtakes admission", async () => {
    const controller=new AbortController();
    let admit!: (value: unknown) => void;
    const request=vi.fn().mockImplementation((call) => call.method === "capabilities.invoke" ? new Promise(resolve => {admit=resolve;}) : Promise.resolve(undefined));
    const pending=sdk(request).invokeAndWait(invocation(),{signal:controller.signal});
    const assertion=expect(pending).rejects.toThrow();
    controller.abort();
    admit({requestId,runId});
    await assertion;
    expect(request.mock.calls.filter(([call])=>call.method==="capabilities.cancel")).toHaveLength(2);
    expect(request.mock.calls.filter(([call])=>call.method==="capabilities.result")).toHaveLength(0);
  });
  it("stops discovery on repeated pagination tokens", async () => {
    const request=vi.fn().mockResolvedValue({providers:[],nextCursor:"repeat"});
    await expect((async()=>{for await(const _provider of sdk(request).discoverAll()) { /* consume */ }})()).rejects.toThrow("cursor_repeated");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
