import "@/styles/styles.css";
import { createRoot } from "react-dom/client";
import { defineComponentApp, type MistyAppSettings } from "@misty/sdk";
import { configureBrowserHomeUrl, configureBrowserSearchEngine } from "@/features/workspace/model";
import {
  type BrowserViewServices as Services,
} from "@/features/browser/SDKBrowserView";
import { BrowserWorkspace } from "./workspace/PinnedBrowserWorkspace";
export { SDKBrowserView, normalizeSdkBrowserAddress } from "@/features/browser/SDKBrowserView";

export default defineComponentApp({
  appId: "browser",
  protocol: 2,
  async mount({ root, misty, context: initialContext, signal }) {
    let context = initialContext,
      closed = false;
    const removers = new Set<() => void>();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    const report = (error: unknown) => {
      if (!closed) void misty.activity.report(String(error).slice(0, 2000)).catch(() => undefined);
    };
    const subscribe = (start: () => Promise<() => void>) => {
      let removed = false,
        stop: (() => void) | undefined;
      const remove = () => {
        removed = true;
        stop?.();
        removers.delete(remove);
      };
      removers.add(remove);
      void start()
        .then((cleanup) => {
          if (removed || closed) cleanup();
          else stop = cleanup;
        })
        .catch(report);
      return remove;
    };
    const services: Services = {
      misty,
      report,
      register: (command, action, enabled) =>
        subscribe(() =>
          misty.shortcuts.register(command, () => {
            if (!closed && (context.focused ?? context.active) && enabled()) action();
          }),
        ),
    };
    const render = () => {
      if (!closed) reactRoot?.render(<BrowserWorkspace services={services} context={context} />);
    };
    const settings = (next: MistyAppSettings) => {
      if (!next.browser)
        throw new Error("This version of Misty does not provide Browser settings.");
      configureBrowserHomeUrl(next.browser.homeUrl);
      configureBrowserSearchEngine(next.browser.searchEngineIndex);
      render();
    };
    const dispose = () => {
      if (closed) return;
      closed = true;
      for (const remove of [...removers]) remove();
      const detachedRoot = reactRoot;
      reactRoot = undefined;
      queueMicrotask(() => detachedRoot?.unmount());
      signal?.removeEventListener("abort", dispose);
    };
    try {
      settings(await misty.settings.snapshot());
      if (signal?.aborted) throw new Error("Browser closed while loading.");
      reactRoot = createRoot(root);
      render();
      subscribe(() => misty.settings.subscribe(settings));
      signal?.addEventListener("abort", dispose, { once: true });
      return {
        update(next) {
          context = next;
          render();
        },
        unmount: dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  },
});
