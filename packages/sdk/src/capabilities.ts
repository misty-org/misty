import {
  MistyCapabilityDefinitionSchema,
  MistyCapabilityManifestSchema,
  type MistyCapabilityDefinition,
  type MistyCapabilityManifest,
  type MistyCapabilityInvocation,
  type MistyMethodParams,
  type MistyMethodResult,
} from "@misty/contracts";
import type { MistyServerSDK } from "./server.js";

/** Validation only. Defining a capability never installs it or grants authority. */
export function defineMistyCapability(definition: MistyCapabilityDefinition): MistyCapabilityDefinition {
  return MistyCapabilityDefinitionSchema.parse(definition);
}
export function defineMistyCapabilityManifest(manifest: MistyCapabilityManifest): MistyCapabilityManifest {
  return MistyCapabilityManifestSchema.parse(manifest);
}

export function createCapabilitiesSDK(server: MistyServerSDK) {
  const api = {
    registerProvider: (input: MistyMethodParams<"capabilities.providers.register">["body"]) =>
      server.call("capabilities.providers.register", { body: input }),
    unregisterProvider: (providerID: string) =>
      server.call("capabilities.providers.unregister", { path: { providerID } }),
    reportAvailability: (providerID: string, availability: MistyMethodParams<"capabilities.providers.availability">["body"]) =>
      server.call("capabilities.providers.availability", { path: { providerID }, body: availability }),
    discover: (input: MistyMethodParams<"capabilities.discover">["body"] = {}) =>
      server.call("capabilities.discover", { body: input }),
    resolveTargets: (input: MistyMethodParams<"capabilities.targets.resolve">["body"]) =>
      server.call("capabilities.targets.resolve", { body: input }),
    invoke: (input: MistyCapabilityInvocation) => server.call("capabilities.invoke", { body: input }),
    result: (requestID: string) => server.call("capabilities.result", { path: { requestID } }),
    cancel: (requestID: string) => server.call("capabilities.cancel", { path: { requestID } }),
  };
  return Object.freeze({
    ...api,
    /** Iterate all authorized provider pages; no fixed discovery cutoff. */
    async *discoverAll(input: MistyMethodParams<"capabilities.discover">["body"] = {}, options: { signal?: AbortSignal } = {}) {
      const seen = new Set<string>();
      let cursor = input.cursor;
      while (true) {
        options.signal?.throwIfAborted();
        if (cursor) {
          if (seen.has(cursor)) throw new Error("capability_discovery_cursor_repeated");
          seen.add(cursor);
        }
        const page = await api.discover({ ...input, cursor });
        options.signal?.throwIfAborted();
        yield* page.providers;
        if (!page.nextCursor) return;
        cursor = page.nextCursor;
      }
    },
    /** Resume observation of an admitted request. Aborting only stops observation. */
    waitForResult: (requestID: string, options: MistyCapabilityWaitOptions = {}) =>
      waitForCapabilityResult(() => api.result(requestID), options),
    /** Stable requestId is reused. Abort requests cancellation; it is not proof an effect stopped. */
    async invokeAndWait(input: MistyCapabilityInvocation, options: Omit<MistyCapabilityWaitOptions, "deadline"> = {}) {
      options.signal?.throwIfAborted();
      const deadline = Date.parse(input.deadline);
      if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error("capability_deadline_expired");
      let cancelPromise: Promise<unknown> | undefined;
      const cancel = () => { cancelPromise ??= api.cancel(input.requestId).catch(() => undefined); };
      options.signal?.addEventListener("abort", cancel, { once: true });
      try {
        await api.invoke(input);
        // Abort can overtake admission; repeat the same cancellation after admission.
        if (options.signal?.aborted) {
          await api.cancel(input.requestId).catch(() => undefined);
          options.signal.throwIfAborted();
        }
        return await waitForCapabilityResult(() => api.result(input.requestId), { ...options, deadline: input.deadline });
      } finally {
        options.signal?.removeEventListener("abort", cancel);
      }
    },
  });
}
export interface MistyCapabilityWaitOptions {
  signal?: AbortSignal;
  /** Observation deadline; expiry never claims the underlying effect was cancelled. */
  deadline?: string;
  pollIntervalMs?: number;
}
type CapabilityResult = MistyMethodResult<"capabilities.result">;
async function waitForCapabilityResult(read: () => Promise<CapabilityResult>, options: MistyCapabilityWaitOptions): Promise<CapabilityResult> {
  const deadline = options.deadline ? Date.parse(options.deadline) : Date.now() + 30 * 60_000;
  const interval = options.pollIntervalMs ?? 1000;
  if (!Number.isFinite(deadline) || !Number.isFinite(interval) || interval < 250 || interval > 30_000) throw new Error("invalid_capability_wait_options");
  while (true) {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("capability_observation_expired: inspect the saved request for its actual outcome");
    const result = await read();
    options.signal?.throwIfAborted();
    if (result.state === "waiting" || !["queued", "running"].includes(result.state)) {
      if (result.state === "completed" && result.outcome?.status !== "success") throw new Error("capability_result_unconfirmed");
      return result;
    }
    await capabilityPollDelay(Math.max(0, Math.min(interval, deadline - Date.now())), options.signal);
  }
}
function capabilityPollDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new Error("capability_observation_aborted")); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export type MistyCapabilitiesSDK = ReturnType<typeof createCapabilitiesSDK>;
