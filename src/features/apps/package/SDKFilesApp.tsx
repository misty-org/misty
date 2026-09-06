import "@/styles/styles.css";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { defineComponentApp } from "@misty/sdk";
import { createSdkFilesWorkspace } from "@/features/files/sdkFilesWorkspace";
import { createSdkFilesServices } from "@/features/files/sdkFilesServices";
import { SdkFilesWorkspaceView } from "@/features/files/SdkFilesWorkspaceView";

export default defineComponentApp({
  appId: "files",
  protocol: 2,
  async mount({ root, misty, signal, context: initialContext }) {
    let closed = false;
    let context = initialContext;
    const lifetime = new AbortController();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    let workspace: ReturnType<typeof createSdkFilesWorkspace> | undefined;
    let services: Awaited<ReturnType<typeof createSdkFilesServices>> | undefined;
    const report = (error: unknown) => {
      if (!closed) void misty.activity.report(String(error).slice(0, 2000)).catch(() => {});
    };
    const dispose = async () => {
      if (closed) return;
      closed = true;
      reactRoot?.unmount();
      try {
        await services?.close();
      } finally {
        try {
          await workspace?.close();
        } finally {
          lifetime.abort();
        }
      }
      signal?.removeEventListener("abort", dispose);
    };
    signal?.addEventListener("abort", dispose, { once: true });
    try {
      if (signal?.aborted) throw new Error("This Files view is closed.");
      workspace = createSdkFilesWorkspace(misty, {
        viewId: context.instanceId,
        signal: lifetime.signal,
        report,
      });
      services = await createSdkFilesServices(misty, workspace, lifetime.signal, report);
      if (closed) {
        await services.close();
        throw new Error("Files closed while opening.");
      }
      await workspace.ready;
      await misty.navigation.setItems([
        { id: "explorer", label: "Explorer", route: "/apps/files" },
        { id: "transfers", label: "Transfers", route: "/apps/files?view=transfers" },
      ]);
      if (closed) throw new Error("Files closed while opening.");
      reactRoot = createRoot(root);
      const render = () => {
        if (!closed)
          reactRoot?.render(
            <MemoryRouter initialEntries={[context.route]}>
              <SdkFilesWorkspaceView
                workspace={workspace!}
                misty={misty}
                signal={lifetime.signal}
                services={services!}
                route={context.route}
              />
            </MemoryRouter>,
          );
      };
      render();
      return {
        update(next) {
          context = next;
          render();
        },
        unmount: dispose,
      };
    } catch (error) {
      await dispose();
      throw error;
    }
  },
});
