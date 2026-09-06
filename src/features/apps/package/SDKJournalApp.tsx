import "@/styles/styles.css";
import { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { defineComponentApp, type MistyAppSDK, type MistyComponentContext } from "@misty/sdk";
import { SpaceNotesView } from "@/features/notes/SpaceNotesView";
import { createSdkNotesRuntime } from "@/features/notes/sdkNotesRuntime";
import { SpaceDrawingsView } from "@/features/drawings/SpaceDrawingsView";
import { createSdkDrawingsRuntime } from "@/features/drawings/sdkDrawingsRuntime";
import { hostAppRoute, packageRoute } from "./routes";

type Journal = {
  misty: MistyAppSDK;
  spaceId: string;
  spaceName: string;
  notes: Awaited<ReturnType<typeof createSdkNotesRuntime>>;
  drawings: Awaited<ReturnType<typeof createSdkDrawingsRuntime>>;
  report(error: unknown): void;
};
function JournalLocation({
  journal,
  context,
}: {
  journal: Journal;
  context: MistyComponentContext;
}) {
  const location = useLocation(),
    navigate = useNavigate();
  const hostRoute = packageRoute("journal", journal.spaceId, context.route);
  const route = `${location.pathname}${location.search}${location.hash}`;
  const previousHost = useRef(hostRoute),
    previousRoute = useRef(hostRoute);
  useLayoutEffect(() => {
    if (previousHost.current !== hostRoute) {
      previousHost.current = hostRoute;
      previousRoute.current = hostRoute;
      if (route !== hostRoute) void navigate(hostRoute, { replace: true });
    } else if (previousRoute.current !== route) {
      previousRoute.current = route;
      void journal.misty.navigation
        .open(hostAppRoute("journal", journal.spaceId, route))
        .catch(journal.report);
    }
  }, [hostRoute, journal, navigate, route]);
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "spaces" || decodeURIComponent(parts[1] || "") !== journal.spaceId) return null;
  if (parts[2] === "drawings")
    return (
      <SpaceDrawingsView
        spaceId={journal.spaceId}
        drawingId={decodeURIComponent(parts[3] || "")}
        runtime={journal.drawings.runtime}
      />
    );
  return (
    <SpaceNotesView
      spaceId={journal.spaceId}
      spaceName={journal.spaceName}
      runtime={journal.notes.runtime}
    />
  );
}

/** An independently mounted Journal component: all external effects use the public SDK. */
export default defineComponentApp({
  appId: "journal",
  protocol: 2,
  async mount({ root, misty, context: initialContext, signal }) {
    let closed = false;
    let context = initialContext;
    const lifetime = new AbortController();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    let notes: Journal["notes"] | undefined, drawings: Journal["drawings"] | undefined;
    const report = (error: unknown) => {
      if (!closed && !lifetime.signal.aborted)
        void misty.activity
          .report(String(error).slice(0, 2000) || "Journal request failed")
          .catch(() => undefined);
    };
    const dispose = () => {
      if (closed) return;
      closed = true;
      reactRoot?.unmount();
      lifetime.abort();
      notes?.close();
      drawings?.close();
      signal?.removeEventListener("abort", dispose);
    };
    signal?.addEventListener("abort", dispose, { once: true });
    try {
      if (signal?.aborted) throw new Error("This Journal view is closed.");
      const identity = await misty.context.get();
      if (!identity.space?.id || !identity.user?.id) throw new Error("Open Journal in a Space.");
      const spaceId = identity.space.id;
      const membership = await misty.server.call("spaces.members.list", {
        path: { spaceID: spaceId },
      });
      if (closed || lifetime.signal.aborted) throw new Error("Journal closed while loading.");
      const shared = {
        misty,
        spaceId,
        userId: identity.user.id,
        signal: lifetime.signal,
        report,
        members: (membership.members ?? []).map((member) => ({
          user_id: member.user_id,
          name: member.name ?? "",
        })),
      };
      notes = await createSdkNotesRuntime(shared);
      drawings = await createSdkDrawingsRuntime({ ...shared, theme: context.appearance.mode });
      if (closed) throw new Error("Journal closed while loading.");
      const journal: Journal = {
        misty,
        spaceId,
        spaceName: identity.space.name,
        notes,
        drawings,
        report,
      };
      await misty.navigation.setItems([
        {
          id: "notes",
          label: "Notes",
          route: `/apps/journal?space=${encodeURIComponent(spaceId)}&view=notes`,
        },
        {
          id: "drawings",
          label: "Drawings",
          route: `/apps/journal?space=${encodeURIComponent(spaceId)}&view=drawings`,
        },
      ]);
      if (closed) throw new Error("Journal closed while loading.");
      reactRoot = createRoot(root);
      const render = () => {
        if (!closed)
          reactRoot?.render(
            <MemoryRouter initialEntries={[packageRoute("journal", spaceId, initialContext.route)]}>
              <JournalLocation journal={journal} context={context} />
            </MemoryRouter>,
          );
      };
      render();
      return {
        update(next) {
          if (!closed) {
            context = next;
            drawings?.setTheme(next.appearance.mode);
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
