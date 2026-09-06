import {
  isMistyAiControlsMethod,
  mistyAiControlsContracts,
  MistyAiControlsSnapshotSchema,
  type MistyAiControlsSnapshot,
  type MistyAiControlsParams,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";

export interface AiControlsBackend {
  snapshot(): MistyAiControlsSnapshot;
  run(input: MistyAiControlsParams<"ai.action.run">): Promise<void>;
  decide(input: MistyAiControlsParams<"ai.proposal.decide">): Promise<void>;
  subscribe(listener: () => void): () => void;
}
export function createAiControlsRpc(scope: AppRpcScope, backend: AiControlsBackend) {
  const subscriptions = new Set<() => void>();
  let closed = false;
  const assert = () => {
    scope.assert("ai.use");
    if (closed) throw new AppRpcError("app_closed", "The App AI controls have closed.");
  };
  const close = () => {
    closed = true;
    for (const remove of subscriptions) remove();
    subscriptions.clear();
    scope.signal.removeEventListener("abort", close);
  };
  scope.signal.addEventListener("abort", close, { once: true });
  if (scope.signal.aborted) close();
  return {
    close,
    async request(message: { method: string; params?: unknown }) {
      assert();
      if (!isMistyAiControlsMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown AI control method.");
      const contract = mistyAiControlsContracts[message.method];
      const params = contract.params.parse(message.params ?? {});
      let result: unknown;
      if (message.method === "ai.snapshot") result = backend.snapshot();
      else if (message.method === "ai.action.run")
        result = await backend.run(params as MistyAiControlsParams<"ai.action.run">);
      else result = await backend.decide(params as MistyAiControlsParams<"ai.proposal.decide">);
      assert();
      return contract.result.parse(result);
    },
    async subscribe(topic: string, listener: (event: unknown) => void) {
      assert();
      if (topic !== "ai") throw new AppRpcError("unsupported_topic", "Unknown AI control event.");
      if (subscriptions.size >= 16)
        throw new AppRpcError("subscription_limit", "Too many AI control subscriptions.");
      let last = "",
        removed = false;
      let unsubscribe: (() => void) | undefined;
      const remove = () => {
        if (removed) return;
        removed = true;
        unsubscribe?.();
        subscriptions.delete(remove);
      };
      const emit = () => {
        if (removed) return;
        let snapshot: MistyAiControlsSnapshot;
        try {
          assert();
          snapshot = MistyAiControlsSnapshotSchema.parse(backend.snapshot());
        } catch {
          remove();
          return;
        }
        const encoded = JSON.stringify(snapshot);
        if (encoded === last) return;
        last = encoded;
        try {
          listener(snapshot);
        } catch {
          remove();
        }
      };
      subscriptions.add(remove);
      try {
        unsubscribe = backend.subscribe(emit);
        if (removed) unsubscribe();
        assert();
        emit();
      } catch (error) {
        remove();
        throw error;
      }
      return remove;
    },
  };
}
