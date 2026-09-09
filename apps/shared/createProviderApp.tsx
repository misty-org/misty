import { withIntegrationShell } from "./IntegrationShell";
import { createWebsiteApp } from "./createWebsiteApp";
import { createRoot } from "react-dom/client";
import {
  defineComponentApp,
  type MistyComponentDefinition,
  type MistyComponentMount,
} from "@misty/sdk";
import { ProviderWorkspace } from "./ProviderWorkspace";
import { providerWebsiteFromRoute } from "./providers";
import "./providers.css";
import { ProviderDirectory } from "./ProviderDirectory";
import { providerAccountsChanged } from "./accountStore";
import {
  loadProviderDirectory,
  providerNavigationItems,
} from "./providerDirectoryStore";

/** Third-party views belong to the downloaded App. Native messaging retains its existing mount. */
export function createProviderApp(
  appId: "chat" | "inbox" | "planner" | "journal",
  legacy?: MistyComponentDefinition,
) {
  if (appId !== "inbox" && !legacy)
    throw new Error(`${appId} requires a native workspace.`);
  if (appId === "planner" || appId === "journal")
    return createWebsiteApp(appId, legacy!);
  return withIntegrationShell(
    appId,
    defineComponentApp({
      appId,
      protocol: 2,
      async mount(input) {
        const identity = await input.misty.context.get();
        if (
          appId !== "inbox" &&
          (identity.platform !== "desktop" || !/Mac/.test(navigator.platform))
        )
          return legacy!.mount(input);
        let context = input.context,
          closed = false,
          generation = 0;
        let child: MistyComponentMount | undefined;
        let childLifetime: AbortController | undefined;
        let root: ReturnType<typeof createRoot> | undefined;
        let nativeMode: boolean | undefined;
        let navigationGeneration = 0;
        let queue = Promise.resolve();
        const report = (error: unknown) => {
          if (!closed)
            void input.misty.activity
              .report(String(error).slice(0, 2000))
              .catch(() => {});
        };
        const refreshNavigation = async () => {
          const run = ++navigationGeneration;
          const state = await loadProviderDirectory(input.misty, appId);
          if (!closed && run === navigationGeneration)
            await input.misty.navigation.setItems(
              providerNavigationItems(appId, state),
            );
        };
        const changed = () => {
          void refreshNavigation().catch(report);
        };
        window.addEventListener(providerAccountsChanged, changed);
        // Legacy mail/messaging mounts may register their full provider menus. The
        // package owns this menu, so every mode uses the same account-aware list.
        const legacySDK = {
          ...input.misty,
          navigation: {
            ...input.misty.navigation,
            setItems: refreshNavigation,
          },
        };
        const render = async () => {
          const url = new URL(context.route, "https://misty.local");
          const directory =
            appId === "inbox"
              ? !providerWebsiteFromRoute(context.route, appId)
              : !url.searchParams.has("provider") &&
                url.searchParams.get("experience") !== "api";
          const nextNative =
            appId !== "inbox" &&
            !directory &&
            !providerWebsiteFromRoute(context.route, appId);
          if (nextNative !== nativeMode) {
            generation++;
            childLifetime?.abort();
            await child?.unmount();
            child = undefined;
            root?.unmount();
            root = undefined;
            if (closed) return;
            nativeMode = nextNative;
            if (nextNative) {
              childLifetime = new AbortController();
              child = await legacy!.mount({
                ...input,
                misty: legacySDK,
                context,
                signal: childLifetime.signal,
              });
              if (closed) {
                await child.unmount();
                child = undefined;
                return;
              }
            } else root = createRoot(input.root);
            await refreshNavigation().catch(report);
          }
          if (closed) return;
          if (child) child.update(context);
          else
            root?.render(
              directory ? (
                <ProviderDirectory appId={appId} misty={input.misty} />
              ) : (
                <ProviderWorkspace
                  key={generation}
                  appId={appId}
                  misty={input.misty}
                  context={context}
                  report={report}
                />
              ),
            );
        };
        const dispose = async () => {
          if (closed) return;
          closed = true;
          window.removeEventListener(providerAccountsChanged, changed);
          childLifetime?.abort();
          root?.unmount();
          root = undefined;
          await queue.catch(() => {});
          await child?.unmount();
          child = undefined;
          input.signal?.removeEventListener("abort", dispose);
        };
        input.signal?.addEventListener("abort", dispose, { once: true });
        if (input.signal?.aborted) {
          await dispose();
          throw new Error("The app closed while opening.");
        }
        try {
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
