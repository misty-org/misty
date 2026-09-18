import { expect, it, vi } from "vitest";
import { createMistyAppSDK, mistyAiControlsContracts } from "@misty/sdk";

it("uses named AI controls and validates event snapshots without exposing host state", async () => {
  const request = vi.fn(async () => ({ available: true, following: false }));
  let receive!: (event: unknown) => void;
  const sdk = createMistyAppSDK({ request, subscribe: async (topic, listener) => { expect(topic).toBe("ai"); receive = listener; return () => {}; } });
  expect(await sdk.ai.snapshot()).toEqual({ available: true, following: false });
  const listener = vi.fn(); await sdk.ai.subscribe(listener);
  receive({ available: true, following: true });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ available: true, following: true });
  expect(() => receive({ available: true, following: false, accountToken: "private" })).toThrow();
  expect(listener).toHaveBeenCalledOnce();
  request.mockResolvedValue(undefined as never);
  await sdk.ai.runAction("notes.improve", "current-selection");
  expect(request).toHaveBeenLastCalledWith({ method: "ai.action.run", params: { actionId: "notes.improve", selectionHash: "current-selection" } });
  await sdk.ai.decideProposal("proposal-a", "accept");
  expect(request).toHaveBeenLastCalledWith({ method: "ai.proposal.decide", params: { proposalId: "proposal-a", decision: "accept" } });
});
it("rejects a caller-supplied prompt, adapter, proposal body or unbounded action ID", () => {
  expect(() => mistyAiControlsContracts["ai.action.run"].params.parse({ actionId: "notes.improve", prompt: "bypass registered action" })).toThrow();
  expect(() => mistyAiControlsContracts["ai.action.run"].params.parse({ actionId: "x".repeat(257) })).toThrow();
  expect(() => mistyAiControlsContracts["ai.proposal.decide"].params.parse({ proposalId: "proposal-a", decision: "accept", operations: { replacement: "bypass proposal" } })).toThrow();
});

it("opens the shared Misty controller with bounded input and no caller context authority",async()=>{
  const request=vi.fn(async()=>undefined);
  const sdk=createMistyAppSDK({request});
  await sdk.ai.open({prompt:"Help with this selection",selectionHash:"revision-1"});
  expect(request).toHaveBeenCalledWith({method:"ai.open",params:{prompt:"Help with this selection",selectionHash:"revision-1"}});
  expect(()=>mistyAiControlsContracts["ai.open"].params.parse({prompt:"x".repeat(8193)})).toThrow();
  expect(()=>mistyAiControlsContracts["ai.open"].params.parse({spaceId:"another-space",context:[]})).toThrow();
});
