import { createRoot } from "react-dom/client";
import { unmountReactRoot } from "./unmountReactRoot";
import { useState } from "react";
import type { MistyAppSDK, MistyComponentDefinition } from "@misty/sdk";
import { ProviderDirectory } from "./ProviderDirectory";
import { WebsiteDirectory } from "./WebsiteDirectory";
import { PlatformPanel } from "./PlatformPanel";
import "./websiteChrome.css";

export type IntegrationAppId =
  "chat" | "inbox" | "planner" | "journal" | "library";
const labels = {
  chat: "Social",
  inbox: "Inbox",
  planner: "Planner",
  journal: "Journal",
  library: "Library",
};
export function integrationDrawerRoute(route: string, open = true) {
  const url = new URL(route, "https://misty.local");
  if (open) {
    url.searchParams.set("drawer", "integrations");
    url.searchParams.delete("manage");
  } else url.searchParams.delete("drawer");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Route-scoped settings use the host modal layer without resizing or unmounting the website. */
export function withIntegrationShell(
  appId: IntegrationAppId,
  app: MistyComponentDefinition,
): MistyComponentDefinition {
  return {
    ...app,
    async mount(input) {
      const identity = await input.misty.context.get();
      if (
        appId !== "inbox" &&
        (identity.platform !== "desktop" || !/Mac/.test(navigator.platform))
      )
        return app.mount(input);
      let context = input.context;
      let closed = false;
      const shell = document.createElement("div");
      shell.className = "integration-app-shell";
      shell.dataset.browserPageContainer = "";
      const surface = document.createElement("div");
      surface.className = "integration-app-content";
      surface.dataset.browserPageContainer = "";
      const chrome = document.createElement("div");
      chrome.className = "integration-app-chrome";
      shell.append(surface, chrome);
      input.root.append(shell);
      const root = createRoot(chrome);
      const render = () => {
        const open =
          new URL(context.route, "https://misty.local").searchParams.get(
            "drawer",
          ) === "integrations";
        shell.dataset.drawerOpen = String(open);
        root.render(
          <IntegrationChrome
            appId={appId}
            misty={input.misty}
            open={open && context.active}
            route={context.route}
            surface={surface}
          />,
        );
      };
      const childContext = () => ({
        ...context,
        route: context.route,
      });
      render();
      let child;
      try {
        child = await app.mount({
          ...input,
          root: surface,
          context: childContext(),
        });
      } catch (error) {
        await unmountReactRoot(root);
        shell.remove();
        throw error;
      }
      return {
        update(next) {
          if (closed) return;
          context = next;
          render();
          child.update(childContext());
        },
        async unmount() {
          if (closed) return;
          closed = true;
          await unmountReactRoot(root);
          await child.unmount();
          shell.remove();
        },
      };
    },
  };
}

function IntegrationChrome({
  appId,
  misty,
  open,
  route,
  surface,
}: {
  appId: IntegrationAppId;
  misty: MistyAppSDK;
  open: boolean;
  route: string;
  surface: HTMLElement;
}) {
  const [error, setError] = useState("");
  return (
    <PlatformPanel
      open={open}
      title={labels[appId]}
      surface={surface}
      onClose={() =>
        void misty.navigation
          .open(integrationDrawerRoute(route, false))
          .catch((reason) => setError(String(reason)))
      }
    >
      {error && <p role="alert">{error}</p>}
      {appId === "chat" || appId === "inbox" ? (
        <ProviderDirectory appId={appId} misty={misty} embedded />
      ) : (
        <WebsiteDirectory appId={appId} misty={misty} embedded />
      )}
    </PlatformPanel>
  );
}
