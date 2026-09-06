import "@/styles/styles.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { defineComponentApp, type MistyComponentContext, type MistyAppSDK } from "@misty/sdk";
import { InboxWorkspaceView } from "@/features/inbox/InboxWorkspaceView";
import { createSdkInboxRuntime } from "@/features/inbox/sdkInboxRuntime";
import { createSdkInboxConnections } from "@/features/inbox/sdkInboxConnections";
import { pickSdkInboxFiles } from "@/features/inbox/sdkInboxFiles";
import { disposeEmailRenderCache, prefetchThreadHtml } from "@/features/inbox/emailRenderCache";
import { useSDKSurfaceRegistration } from "@/features/ai-surface/SDKSurfaceRegistration";
import type { InboxAttachmentPickerProps, InboxUiRuntime } from "@/features/inbox/inboxUiRuntime";
import type { InboxWorkspaceRuntime } from "@/features/inbox/inboxWorkspaceRuntime";

function createPicker(misty: MistyAppSDK, signal: AbortSignal, report: (error: unknown) => void) {
  return function Picker(props: InboxAttachmentPickerProps) {
    const latest = useRef(props);
    latest.current = props;
    useEffect(() => {
      let mounted = true;
      void pickSdkInboxFiles(misty, signal)
        .then((files) => {
          if (mounted && !signal.aborted) {
            if (files.length) latest.current.onFiles(files);
            else latest.current.onCancel();
          }
        })
        .catch((error) => {
          if (mounted && !signal.aborted) {
            report(error);
            latest.current.onCancel();
          }
        });
      return () => {
        mounted = false;
      };
    }, []);
    return null;
  };
}

export default defineComponentApp({
  appId: "inbox",
  protocol: 2,
  async mount({ root, misty, signal, context: initialContext }) {
    let context = initialContext,
      closed = false;
    const lifetime = new AbortController();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    let inbox: ReturnType<typeof createSdkInboxRuntime> | undefined;
    const report = (error: unknown) => {
      if (!closed && !lifetime.signal.aborted)
        void misty.activity.report(String(error).slice(0, 2000)).catch(() => undefined);
    };
    const dispose = () => {
      if (closed) return;
      closed = true;
      reactRoot?.unmount();
      lifetime.abort();
      inbox?.close();
      disposeEmailRenderCache();
      signal?.removeEventListener("abort", dispose);
    };
    signal?.addEventListener("abort", dispose, { once: true });
    try {
      if (signal?.aborted) throw new Error("This Inbox view is closed.");
      const identity = await misty.context.get();
      if (!identity.user?.id) throw new Error("Sign in to open Inbox.");
      if (closed) throw new Error("Inbox closed while loading.");
      const userId = identity.user.id;
      inbox = createSdkInboxRuntime({
        misty,
        userId,
        signal: lifetime.signal,
        prefetchHtml: prefetchThreadHtml,
        report,
      });
      const store = inbox.store;
      const useConnections = createSdkInboxConnections(misty, userId, lifetime.signal);
      const ui: InboxUiRuntime = {
        Picker: createPicker(misty, lifetime.signal, report),
        openLink: (url) => misty.links.openExternal(url),
        report: (options) => report(options.error),
      };
      const useAiSurfaceAdapter: InboxWorkspaceRuntime["useAiSurfaceAdapter"] = (adapter) =>
        useSDKSurfaceRegistration({ misty, adapter: adapter ?? null, report });
      const useAiSurfaceActions: InboxWorkspaceRuntime["useAiSurfaceActions"] = (adapter) => ({
        available: Boolean(adapter),
        runAction: (action) =>
          misty.ai.runAction(action.id, adapter?.getSelection?.()?.contentHash),
      });
      const useMobileSurfaceChrome = () => undefined;
      function Inbox({ current }: { current: MistyComponentContext }) {
        const connections = useConnections();
        const location = useLocation(),
          navigate = useNavigate();
        const route = `${location.pathname}${location.search}${location.hash}`;
        const previousHost = useRef(current.route),
          previousRoute = useRef(current.route);
        useLayoutEffect(() => {
          if (previousHost.current !== current.route) {
            previousHost.current = current.route;
            previousRoute.current = current.route;
            if (route !== current.route) void navigate(current.route, { replace: true });
          } else if (previousRoute.current !== route) {
            previousRoute.current = route;
            void misty.navigation.open(route).catch(report);
          }
        }, [current.route, navigate, route]);
        return (
          <InboxWorkspaceView
            workspaceId={current.instanceId}
            runtime={{
              identity: { user: { id: userId }, transitioning: false },
              store,
              connections,
              ui,
              presentation: "desktop",
              focused: current.active && current.focused !== false,
              openAuthorization: async (url) => {
                await misty.links.openExternal(url);
                return undefined;
              },
              useAiSurfaceAdapter,
              useAiSurfaceActions,
              useMobileSurfaceChrome,
            }}
          />
        );
      }
      await misty.navigation.setItems([
        { id: "google", label: "Gmail", route: "/apps/inbox?provider=google" },
        { id: "microsoft", label: "Outlook", route: "/apps/inbox?provider=microsoft" },
      ]);
      await misty.workspace.setTitle("Inbox");
      if (closed) throw new Error("Inbox closed while loading.");
      reactRoot = createRoot(root);
      const render = () => {
        if (!closed)
          reactRoot?.render(
            <MemoryRouter initialEntries={[initialContext.route]}>
              <Inbox current={context} />
            </MemoryRouter>,
          );
      };
      render();
      return {
        update(next) {
          if (!closed) {
            context = next;
            render();
          }
        },
        unmount: dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  },
});
