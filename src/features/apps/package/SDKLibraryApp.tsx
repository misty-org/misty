import { PointerDragProvider } from "@/features/dnd";
import "@/styles/styles.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { defineComponentApp, type MistyComponentContext } from "@misty/sdk";
import { SpaceLibrary } from "@/features/spaces/library/SpaceLibrary";
import { createSdkLibraryRuntime } from "@/features/spaces/library/sdkLibraryRuntime";
export default defineComponentApp({
  appId: "library",
  protocol: 2,
  async mount({ root, misty, signal, context: initial }) {
    let context = initial,
      closed = false;
    const lifetime = new AbortController();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    let runtime: Awaited<ReturnType<typeof createSdkLibraryRuntime>> | undefined;
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
      if (signal?.aborted) throw new Error("Library is closed.");
      runtime = await createSdkLibraryRuntime(misty, context, lifetime.signal, report);
      if (closed) {
        runtime.close();
        throw new Error("Library closed while opening.");
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
            void misty.navigation.open(route).catch(report);
          }
        }, [next.route, navigate, route]);
        return <SpaceLibrary spaceId={runtime!.spaceId} workspaceTabId={next.instanceId} />;
      }
      await misty.navigation.setItems(
        [
          ["recent", "All items"],
          ["favorites", "Favorites"],
          ["collections", "Collections"],
          ["albums", "Albums"],
          ["deleted", "Recently deleted"],
        ].map(([id, label]) => ({
          id,
          label,
          route: id === "recent" ? "/apps/library" : `/apps/library?collection=${id}`,
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
