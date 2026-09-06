import { PointerDragProvider } from "@/features/dnd";
import "@/styles/styles.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { defineComponentApp, type MistyComponentContext } from "@misty/sdk";
import { SpaceSocial } from "@/features/spaces/chat/SpaceChat";
import { socialProvider } from "@/features/spaces/social/socialRoute";
import { createSdkSocialRuntime } from "@/features/spaces/chat/sdkSocialRuntime";
export default defineComponentApp({
  appId: "chat",
  protocol: 2,
  async mount({ root, misty, signal, context: initial }) {
    let context = initial,
      closed = false;
    const lifetime = new AbortController();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    let runtime: Awaited<ReturnType<typeof createSdkSocialRuntime>> | undefined;
    const report = (error: unknown) => {
      if (!closed) void misty.activity.report(String(error).slice(0, 2000)).catch(() => undefined);
    };
    const dispose = () => {
      if (closed) return;
      closed = true;
      reactRoot?.unmount();
      lifetime.abort();
      runtime?.close();
      signal?.removeEventListener("abort", dispose);
    };
    signal?.addEventListener("abort", dispose, { once: true });
    try {
      if (signal?.aborted) throw new Error("Social is closed.");
      runtime = await createSdkSocialRuntime(misty, context, lifetime.signal, report);
      if (closed) {
        runtime.close();
        throw new Error("Social closed while opening.");
      }
      function Route({ context: next }: { context: MistyComponentContext }) {
        const navigate = useNavigate(),
          location = useLocation();
        const route = location.pathname + location.search + location.hash;
        const previousHost = useRef(next.route),
          previousRoute = useRef(next.route);
        useLayoutEffect(() => {
          if (previousHost.current !== next.route) {
            previousHost.current = next.route;
            previousRoute.current = next.route;
            if (route !== next.route) void navigate(next.route, { replace: true });
          } else if (previousRoute.current !== route) {
            previousRoute.current = route;
            void misty.navigation.open(socialAppRoute(route)).catch(report);
          }
        }, [next.route, navigate, route]);
        return (
          <SpaceSocial
            spaceId={runtime!.spaceId}
            spaceName={runtime!.spaceName}
            provider={
              socialProvider(
                new URLSearchParams(location.search).get("provider") ??
                  location.pathname.split("/")[4],
              ) ?? "misty"
            }
            workspaceTabId={next.instanceId}
          />
        );
      }
      await misty.navigation.setItems(
        ["misty", "instagram", "messenger", "x", "discord"].map((provider) => ({
          id: provider,
          label: provider === "x" ? "X" : provider[0].toUpperCase() + provider.slice(1),
          route: `/apps/social?provider=${provider}`,
        })),
      );
      if (closed) throw new Error("The app closed while loading.");
      reactRoot = createRoot(root);
      const render = () =>
        reactRoot?.render(
          <MemoryRouter initialEntries={[context.route]}>
            <PointerDragProvider>
              <Route context={context} />
            </PointerDragProvider>
          </MemoryRouter>,
        );
      render();
      return {
        update(next) {
          context = next;
          runtime?.update(next);
          if (!closed) render();
        },
        unmount: dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  },
});

function socialAppRoute(route: string) {
  const url = new URL(route, "https://misty.local");
  const parts = url.pathname.split("/");
  if (parts[1] === "spaces" && parts[3] === "social") {
    url.pathname = "/apps/social";
    url.searchParams.set("provider", parts[4] || "misty");
  }
  return url.pathname + url.search + url.hash;
}
