import { PointerDragProvider } from "@/features/dnd";
import "@/styles/styles.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { defineComponentApp, type MistyComponentContext } from "@misty/sdk";
import AgentsPage from "@/features/agents/AgentsPage";
import { createSdkAgentsRuntime } from "@/features/agents/sdkAgentsRuntime";
export default defineComponentApp({
  appId: "agents",
  protocol: 2,
  async mount({ root, misty, signal, context: initial }) {
    let context = initial,
      closed = false;
    const lifetime = new AbortController();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    let runtime: Awaited<ReturnType<typeof createSdkAgentsRuntime>> | undefined;
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
      if (signal?.aborted) throw new Error("Agents is closed.");
      runtime = await createSdkAgentsRuntime(misty, context, lifetime.signal, report);
      if (closed) {
        runtime.close();
        throw new Error("Agents closed while opening.");
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
        return <AgentsPage />;
      }
      await misty.navigation.setItems([
        { id: "chat", label: "Chat", route: "/apps/agents" },
        { id: "automations", label: "Automations", route: "/apps/agents?view=automations" },
      ]);
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
