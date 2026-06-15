import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  defineComponentApp,
  type MistyAppSDK,
  type MistyAppSettings,
  type MistyComponentContext,
  type MistySurfaceAdapter,
  type MistyAppCommand,
} from "@misty/sdk";
import { TerminalWorkspaceView, killTerminalTab } from "@/features/terminal/TerminalWorkspaceView";
import type { TerminalServices } from "@/features/terminal/terminalServices";

function Surface({ misty, adapter }: { misty: MistyAppSDK; adapter: MistySurfaceAdapter }) {
  useEffect(() => {
    let removed = false;
    let cleanup: (() => void) | undefined;
    void misty.surfaces
      .register(adapter)
      .then((remove) => {
        if (removed) remove();
        else cleanup = remove;
      })
      .catch((error) => {
        if (!removed) void misty.activity.report(String(error)).catch(() => undefined);
      });
    return () => {
      removed = true;
      cleanup?.();
    };
  }, [misty, adapter]);
  return null;
}

export default defineComponentApp({
  appId: "terminal",
  protocol: 2,
  async mount({ root, misty, context: initialContext }) {
    let context = initialContext;
    let settings: MistyAppSettings;
    let closed = false;
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    const report = (error: unknown) => {
      if (!closed) void misty.activity.report(String(error).slice(0, 2000)).catch(() => undefined);
    };
    const services: TerminalServices = {
      terminal: misty.terminal,
      clipboard: misty.clipboard,
      openExternal: misty.links.openExternal,
      reportError: report,
    };
    const renameTab = (title: string) => {
      void misty.workspace
        .setTitle(title.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "Terminal")
        .catch(report);
    };
    const registerCommand = (id: string, action: () => void, enabled: () => boolean) => {
      let removed = false;
      let cleanup: (() => void) | undefined;
      void misty.shortcuts
        .register(id as MistyAppCommand, () => {
          if (!removed && enabled()) action();
        })
        .then((remove) => {
          if (removed) remove();
          else cleanup = remove;
        })
        .catch(report);
      return () => {
        removed = true;
        cleanup?.();
      };
    };
    const renderAiAdapter = (adapter: MistySurfaceAdapter) => (
      <Surface misty={misty} adapter={adapter} />
    );
    const render = () => {
      if (closed || !settings?.terminal) return;
      reactRoot?.render(
        <TerminalWorkspaceView
          tabId={context.instanceId}
          active={context.active}
          focused={context.focused ?? context.active}
          services={services}
          preferences={settings.terminal}
          searchShortcutLabel={settings.shortcutLabels?.["terminal.search"] ?? ""}
          renameTab={renameTab}
          registerCommand={registerCommand}
          renderAiAdapter={renderAiAdapter}
        />,
      );
    };
    const unsubscribeSettings = await misty.settings.subscribe((next) => {
      settings = next;
      render();
    });
    try {
      settings = await misty.settings.snapshot();
      if (!settings.terminal)
        throw new Error("This version of Misty does not provide Terminal settings.");
      reactRoot = createRoot(root);
      render();
    } catch (error) {
      unsubscribeSettings();
      reactRoot?.unmount();
      throw error;
    }
    return {
      update(next: MistyComponentContext) {
        if (!closed) {
          context = next;
          render();
        }
      },
      unmount() {
        if (closed) return;
        closed = true;
        unsubscribeSettings();
        reactRoot?.unmount();
        killTerminalTab(context.instanceId);
      },
    };
  },
});
