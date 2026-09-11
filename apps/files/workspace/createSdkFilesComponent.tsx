import { createRoot } from "react-dom/client";
import { defineComponentApp, type MistyComponentContext, type MistyComponentDefinition } from "@misty/sdk";
import { createSdkFilesWorkspace } from "./sdkFilesWorkspace";
import { createSdkFilesServices } from "./sdkFilesServices";
import { SdkFilesWorkspaceView } from "./SdkFilesWorkspaceView";
import { createSdkFilesTransferHistory, type SdkFilesTransferHistory } from "./sdkFilesTransferHistory";
import { SdkFilesTransfersView } from "./SdkFilesTransfersView";

/** Explorer, transfer presentation and history are owned by the downloaded app. */
export function createSdkFilesComponent(sharedHistory?: SdkFilesTransferHistory): MistyComponentDefinition {
  return defineComponentApp({
    appId: "files",
    protocol: 2,
    createSession() {
      const history = createSdkFilesTransferHistory();
      const component = createSdkFilesComponent(history);
      return { mount: component.mount, close: () => history.close() };
    },
    async mount({ root, misty, context, signal }) {
      const lifetime = new AbortController();
      const history = sharedHistory ?? createSdkFilesTransferHistory();
      let latest = context;
      let detachHistory: (() => void | Promise<void>) | undefined;
      const report = (error: unknown) => {
        if (!lifetime.signal.aborted)
          void misty.activity.report(String(error).slice(0, 2000)).catch(() => undefined);
      };
      const workspace = createSdkFilesWorkspace(misty, {
        viewId: context.instanceId, signal: lifetime.signal, report,
      });
      let services: Awaited<ReturnType<typeof createSdkFilesServices>> | undefined;
      let starting: Promise<void> | undefined;
      let closing: Promise<void> | undefined;
      const reactRoot = createRoot(root);
      const check = () => {
        if (signal?.aborted || lifetime.signal.aborted) throw new Error("This Files view is closed.");
      };
      const close = () => {
        if (closing) return closing;
        // Flush history while this view's SDK is still available when possible.
        const detached = detachHistory?.();
        lifetime.abort();
        signal?.removeEventListener("abort", abort);
        closing = Promise.resolve().then(async () => {
          reactRoot.unmount();
          await starting?.catch(() => undefined);
          try { await services?.close(); }
          finally {
            await workspace.close();
            await detached;
            if (!sharedHistory) history.close();
          }
        });
        return closing;
      };
      const abort = () => { void close().catch(() => undefined); };
      signal?.addEventListener("abort", abort, { once: true });
      const render = () => {
        check();
        const transfers = new URL(latest.route, "https://misty.local").searchParams.get("view") === "transfers";
        workspace.model.setState({ active: latest.active && !transfers });
        if (transfers) {
          reactRoot.render(<SdkFilesTransfersView history={history} misty={misty} />);
        } else if (services) {
          reactRoot.render(<SdkFilesWorkspaceView workspace={workspace} misty={misty} signal={lifetime.signal} services={services} route={latest.route} />);
        } else {
          reactRoot.render(<div role="status" className="p-3 text-sm text-cream-muted">Opening Files…</div>);
          if (!starting) starting = (async () => {
            services = await createSdkFilesServices(misty, workspace, lifetime.signal, report);
            check();
            const selectedName = new URL(latest.route, "https://misty.local").searchParams.get("select");
            const entry = workspace.files.store.getState().pane.listing?.entries.find(entry => entry.name === selectedName);
            if (entry) workspace.files.select(entry.id);
            render();
          })().catch(error => {
            if (lifetime.signal.aborted) return;
            report(error);
            starting = undefined;
            reactRoot.render(<div role="alert" className="p-3 text-sm">{String(error)}<button className="ml-3 underline" onClick={render}>Retry</button></div>);
          });
        }
      };
      try {
        check();
        await workspace.ready;
        check();
        detachHistory = await history.register(workspace.files, misty, lifetime.signal);
        check();
        await misty.navigation.setItems([
          { id: "explorer", label: "Explorer", route: "/apps/files" },
          { id: "transfers", label: "Transfers", route: "/apps/files?view=transfers" },
        ]);
        check();
        render();
        return { update(next: MistyComponentContext) { latest = next; render(); }, unmount: close };
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
    },
  });
}
