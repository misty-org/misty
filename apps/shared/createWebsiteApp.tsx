import { withIntegrationShell } from "./IntegrationShell";
import { createRoot } from "react-dom/client";
import {
  defineComponentApp,
  type MistyComponentDefinition,
  type MistyComponentMount,
} from "@misty/sdk";
import { providerAccountsChanged } from "./accountStore";
import { WebsiteDirectory } from "./WebsiteDirectory";
import { WebsiteWorkspace } from "./WebsiteWorkspace";
import { integrationFromRoute, type WebsiteAppId } from "./websiteIntegrations";
import {
  loadWebsiteState,
  restoredWebsiteDestination,
  saveWebsiteDestination,
  websiteNavigation,
} from "./websiteStore";
import "./providers.css";
import "./websites.css";
/** Native views retain their own services and lifecycle; websites need no Space. */
export function createWebsiteApp(
  appId: WebsiteAppId,
  native: MistyComponentDefinition,
) {
  return withIntegrationShell(
    appId,
    defineComponentApp({
      appId,
      protocol: 2,
      async mount(input) {
        const identity = await input.misty.context.get();
        if (identity.platform !== "desktop" || !/Mac/.test(navigator.platform))
          return native.mount(input);
        let context = input.context,
          closed = false,
          mode = "",
          navigationGeneration = 0;
        let child: MistyComponentMount | undefined,
          lifetime: AbortController | undefined;
        let root: ReturnType<typeof createRoot> | undefined;
        let queue = Promise.resolve();
        let savedRoute: string | undefined;
        let navigationReady = false;
        const report = (error: unknown) => {
          if (!closed)
            void input.misty.activity
              .report(String(error).slice(0, 2000))
              .catch(() => {});
        };
        const refreshNavigation = async () => {
          const run = ++navigationGeneration;
          const state = await loadWebsiteState(
            input.misty.storage.local,
            appId,
          );
          if (!closed && run === navigationGeneration)
            await input.misty.navigation.setItems(
              websiteNavigation(appId, state, identity.space?.id),
            );
        };
        const changed = () => {
          void refreshNavigation().catch(report);
        };
        window.addEventListener(providerAccountsChanged, changed);
        const nativeSDK = {
          ...input.misty,
          navigation: {
            ...input.misty.navigation,
            setItems: refreshNavigation,
          },
        };
        const render = async () => {
          if (closed) return;
          const url = new URL(context.route, "https://misty.local");
          const provider = integrationFromRoute(context.route, appId);
          const nextMode = provider
            ? `website:${provider}`
            : url.searchParams.get("view") === "integrations"
              ? "directory"
              : identity.space?.id
                ? "native"
                : "no-space";
          if (mode !== nextMode) {
            lifetime?.abort();
            await child?.unmount();
            child = undefined;
            root?.unmount();
            root = undefined;
            if (closed) return;
            mode = nextMode;
            if (mode === "native") {
              lifetime = new AbortController();
              child = await native.mount({
                ...input,
                misty: nativeSDK,
                context,
                signal: lifetime.signal,
              });
              if (closed) {
                await child.unmount();
                child = undefined;
                return;
              }
            } else root = createRoot(input.root);
          }
          if (closed) return;
          if (child) child.update(context);
          else if (mode === "directory")
            root?.render(
              <WebsiteDirectory appId={appId} misty={input.misty} />,
            );
          else if (provider)
            root?.render(
              <WebsiteWorkspace
                key={provider}
                appId={appId}
                provider={provider}
                misty={input.misty}
                context={context}
                report={report}
              />,
            );
          else
            root?.render(
              <section className="provider-workspace">
                <div className="website-empty">
                  <h2>Open Misty in a Space</h2>
                  <p>
                    Select a Space to use your{" "}
                    {appId === "journal"
                      ? "notes and drawings"
                      : appId === "library"
                        ? "shared files and collections"
                        : "tasks, agenda, and roadmaps"}
                    . Your websites are available here too.
                  </p>
                  <button
                    onClick={() =>
                      void input.misty.navigation
                        .open(`/apps/${appId}?view=integrations`)
                        .catch(report)
                    }
                  >
                    Choose a website
                  </button>
                </div>
              </section>,
            );
          // Visibility/focus updates reuse the page and need no storage reload.
          if (!navigationReady) {
            await refreshNavigation();
            navigationReady = true;
          }
          if (savedRoute !== context.route) {
            const route = context.route;
            await saveWebsiteDestination(
              input.misty.storage.local,
              context.instanceId,
              route,
            );
            savedRoute = route;
          }
        };
        const dispose = async () => {
          if (closed) return;
          closed = true;
          window.removeEventListener(providerAccountsChanged, changed);
          lifetime?.abort();
          root?.unmount();
          root = undefined;
          await queue.catch(() => {});
          await child?.unmount();
          child = undefined;
          input.signal?.removeEventListener("abort", dispose);
        };
        input.signal?.addEventListener("abort", dispose, { once: true });
        try {
          if (input.signal?.aborted)
            throw new Error("The app closed while opening.");
          const url = new URL(context.route, "https://misty.local");
          if (url.pathname === `/apps/${appId}` && !url.search && !url.hash) {
            const restored = await restoredWebsiteDestination(
              input.misty.storage.local,
              context.instanceId,
            );
            if (
              typeof restored === "string" &&
              restored.startsWith(`/apps/${appId}`) &&
              new URL(restored, "https://misty.local").pathname ===
                `/apps/${appId}`
            ) {
              const state = await loadWebsiteState(
                  input.misty.storage.local,
                  appId,
                ),
                provider = integrationFromRoute(restored, appId);
              if (
                !provider ||
                state.services.some((s) => s.id === provider && !s.removing)
              ) {
                context = { ...context, route: restored };
                await input.misty.navigation.open(restored);
              }
            }
          }
          queue = render();
          await queue;
        } catch (error) {
          await dispose();
          throw error;
        }
        return {
          update(next) {
            context = next;
            queue = queue.then(render).catch(report);
          },
          unmount: dispose,
        };
      },
    }),
  );
}
