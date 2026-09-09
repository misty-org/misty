import type { MistyAppSDK } from "@misty/sdk";
import { createSdkInboxServices } from "./inboxServices";
import { createSdkInboxCache } from "./sdkInboxCache";
import { createInboxStoreWithRuntime, disposeInboxStore } from "./store/inboxStore";
import type { InboxThread } from "./model";

/** An Inbox mount owns its requests, cache queue, selection and detail-prefetch map. */
export function createSdkInboxRuntime(options: {
  misty: MistyAppSDK;
  userId: string;
  signal: AbortSignal;
  prefetchHtml(thread: InboxThread): void;
  report(error: unknown): void;
}) {
  const lifetime = new AbortController();
  const cache = createSdkInboxCache(options.misty, lifetime.signal, options.report);
  const store = createInboxStoreWithRuntime({
    api: createSdkInboxServices(options.misty, lifetime.signal),
    ...cache,
    signal: lifetime.signal,
    prefetchHtml: options.prefetchHtml,
    errorMessage: (_code, fallback) => fallback,
  });
  const close = () => {
    lifetime.abort();
    disposeInboxStore(store);
    options.signal.removeEventListener("abort", close);
  };
  options.signal.addEventListener("abort", close, { once: true });
  if (options.signal.aborted) close();
  else store.getState().setAccount(options.userId);
  return { store, close };
}
