import { useAuth } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";
import { Button, PermissionState } from "@/shared/ui";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { preferredMistySpace } from "../mistySpace";
import { CreateSpaceDialog } from "../spacesShell/CreateSpaceDialog";
import type { SpacesShellOutletContext } from "../spacesShell/outletContext";
import { SpaceInvitationSidebar, SpaceInvitationView } from "../spacesShell/SpaceInvitationView";
import { readPanelVisible, writePanelVisible } from "../spacesShell/spacesShellStorage";
import { rememberSpaceSubpageRoute } from "../spacesShell/spaceSubpageMemory";
import { useCreateSpaceDialog } from "../spacesShell/useCreateSpaceDialog";
import { useCreateSpaceRouteRequest } from "../spacesShell/useCreateSpaceRouteRequest";
import { useSpacesStore } from "../store/useSpacesStore";
import {
  activeSpacesTab,
  defaultSpaceRoute,
  normalizeSpacesTabRoute,
  spacesTabsSessionKey,
  useSpacesTabsStore,
} from "../store/useSpacesTabsStore";
import { SpacePageFrame } from "./SpacePageLayout";
import { useSpacePanelRoute } from "./spacePanel/spacePanelRoute";
import { SpacePanelContent } from "./SpacePanelContent";
import { spacesBottomBarActionsId, SpacesBottomBarToggle } from "./SpacesBottomBar";
import { SpacesAppLoadingPlaceholder } from "./SpacesLoadingPlaceholder";
import { SpacesReconnectScreen } from "./SpacesReconnectScreen";

export { SpacesIndexRedirect } from "../spacesShell/SpacesIndexRedirect";

export default function SpacesShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, transitioning } = useAuth();
  const accountId = user?.id ?? "";
  const currentSpacesRoute = `${location.pathname}${location.search}${location.hash}`;
  const pendingTabRouteRef = useRef<string | null>(null);
  const handledLocationKeyRef = useRef<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(readPanelVisible);
  const {
    spaces,
    invitations,
    loading,
    snapshotReady,
    referenceOnly,
    error,
    load,
    createSpace,
    respondInvite,
    setViewingSpace,
    clearError,
  } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      invitations: state.invitations,
      loading: state.loading,
      snapshotReady: state.snapshotReady,
      referenceOnly: state.referenceOnly,
      error: state.error,
      load: state.load,
      createSpace: state.createSpace,
      respondInvite: state.respondInvite,
      setViewingSpace: state.setViewingSpace,
      clearError: state.clearError,
    })),
  );
  const dialog = useCreateSpaceDialog({ createSpace, clearError });
  useCreateSpaceRouteRequest(dialog.start);
  const panelRoute = useSpacePanelRoute();
  const activeSpace = spaces.find((space) => space.id === panelRoute.activeSpaceId);
  const activeInvitation = invitations.find(
    (invitation) => invitation.space_id === panelRoute.activeSpaceId,
  );
  const sessionKey = spacesTabsSessionKey(accountId, panelRoute.activeSpaceId);
  const tabSession = useSpacesTabsStore((state) => state.sessions[sessionKey]);
  const activeTab = activeSpacesTab(tabSession);
  const {
    ensureTabSession,
    addWorkspaceTab,
    selectWorkspaceTab,
    updateActiveSpaceRoute,
    pruneTabSessions,
  } = useSpacesTabsStore(
    useShallow((state) => ({
      ensureTabSession: state.ensureSession,
      addWorkspaceTab: state.addTab,
      selectWorkspaceTab: state.selectTab,
      updateActiveSpaceRoute: state.updateActiveSpaceRoute,
      pruneTabSessions: state.pruneSessions,
    })),
  );

  const routeParts = location.pathname.split("/").filter(Boolean);
  const detailRouteActive = routeParts[0] === "spaces" && routeParts.length >= 3;
  const spaceSurfaceActive = Boolean(activeInvitation || activeTab?.kind === "space");
  const reconnect = useCallback(() => void load({ force: true, accountId }), [accountId, load]);

  const respondToActiveInvitation = async (accept: boolean) => {
    if (!activeInvitation) return;
    clearError();
    await respondInvite(activeInvitation.id, accept);
    navigate(accept ? defaultSpaceRoute(activeInvitation.space_id) : "/spaces", {
      replace: true,
      state: { mistySpaceSwitch: true },
    });
  };

  useEffect(() => {
    if (!user) return;
    void load({ accountId: user.id });
    // Re-fires on account switch so Spaces reloads for the new account
    // instead of leaving whatever was last fetched (or was in flight) for
    // the previous one sitting in the shared store.
  }, [load, user]);
  useEffect(() => {
    if (!user?.id) return;
    const refresh = () => void load({ force: true, accountId: user.id });
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [load, user?.id]);
  useEffect(() => {
    if (!user) clearError();
  }, [clearError, user]);
  useEffect(() => {
    if (!snapshotReady || loading || !panelRoute.activeSpaceId || activeSpace || activeInvitation)
      return;
    const fallback = preferredMistySpace(spaces);
    navigate(fallback ? defaultSpaceRoute(fallback.id) : "/spaces", {
      replace: true,
      state: { mistySpaceSwitch: true },
    });
  }, [
    activeInvitation,
    activeSpace,
    loading,
    navigate,
    panelRoute.activeSpaceId,
    snapshotReady,
    spaces,
  ]);
  useEffect(() => {
    if (!user?.id || !activeSpace?.id) {
      setViewingSpace("");
      return;
    }
    setViewingSpace(activeSpace.id);
    return () => setViewingSpace("");
  }, [activeSpace?.id, setViewingSpace, user?.id]);

  // Push the space's name up to the workspace tab that hosts it so the tab
  // bar (and the collapsed "Spaces" dropdown) shows real names instead of a
  // stack of generic "Space" entries.
  useEffect(() => {
    if (!activeSpace?.id || !activeSpace.name) return;
    const groupKey = `space:${activeSpace.id}` as const;
    const state = useWorkspaceStore.getState();
    const tab = state.layout.panes
      .flatMap((pane) => pane.tabs)
      .find((entry) => entry.groupKey === groupKey);
    if (tab) state.renameTab(tab.id, activeSpace.name);
  }, [activeSpace?.id, activeSpace?.name]);
  useEffect(() => writePanelVisible(panelVisible), [panelVisible]);
  useEffect(() => {
    if (!accountId || !snapshotReady) return;
    pruneTabSessions(
      accountId,
      spaces.map((space) => space.id),
    );
  }, [accountId, pruneTabSessions, snapshotReady, spaces]);
  useEffect(() => {
    if (!accountId || !activeSpace?.id) return;
    ensureTabSession(accountId, activeSpace.id, currentSpacesRoute);
  }, [accountId, activeSpace?.id, currentSpacesRoute, ensureTabSession]);
  useEffect(() => {
    if (!accountId || !activeSpace?.id || !tabSession) return;
    const normalizedRoute = normalizeSpacesTabRoute(currentSpacesRoute, activeSpace.id);
    const pendingRoute = pendingTabRouteRef.current;
    if (pendingRoute) {
      if (normalizedRoute !== pendingRoute) return;
      pendingTabRouteRef.current = null;
    }
    if (handledLocationKeyRef.current === location.key) return;
    handledLocationKeyRef.current = location.key;
    if (activeTab?.kind === "space") {
      updateActiveSpaceRoute(accountId, activeSpace.id, normalizedRoute);
      return;
    }
    const state = location.state as { mistySpaceSwitch?: boolean } | null;
    if (state?.mistySpaceSwitch) return;
    const newTabId = addWorkspaceTab(accountId, activeSpace.id, "space", normalizedRoute);
    if (newTabId) selectWorkspaceTab(accountId, activeSpace.id, newTabId);
  }, [
    accountId,
    activeSpace?.id,
    activeTab?.kind,
    addWorkspaceTab,
    currentSpacesRoute,
    location.key,
    location.state,
    selectWorkspaceTab,
    tabSession,
    updateActiveSpaceRoute,
  ]);
  useEffect(() => {
    if (activeTab?.kind !== "space") return;
    rememberSpaceSubpageRoute(accountId, panelRoute.activeSpaceId, currentSpacesRoute);
  }, [accountId, activeTab?.kind, currentSpacesRoute, panelRoute.activeSpaceId]);

  if (transitioning) return <SpacesAppLoadingPlaceholder />;

  if (!user)
    return (
      <PermissionState
        className="h-full"
        title="Sign in to use Spaces"
        description="Spaces need an active Misty session before they can load messages, Planner items, notes, and Library items."
        action={
          <Button
            type="button"
            onClick={() =>
              navigate("/signin", {
                state: { from: `${location.pathname}${location.search}${location.hash}` },
              })
            }
          >
            Sign in
          </Button>
        }
      />
    );

  if (referenceOnly) {
    return <SpacesReconnectScreen onReconnect={reconnect} />;
  }

  const outletContext = {
    openCreateSpaceDialog: dialog.start,
  } satisfies SpacesShellOutletContext;

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}>
      <div
        className={[
          "grid h-full min-h-0 bg-charcoal-bg",
          "grid-rows-[minmax(0,1fr)_32px] overflow-hidden",
          "transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        ].join(" ")}
        style={{
          gridTemplateColumns:
            panelVisible && spaceSurfaceActive
              ? "clamp(248px, 18vw, 268px) minmax(0, 1fr)"
              : "0px minmax(0, 1fr)",
        }}
      >
        <AnimatePresence initial={false}>
          {panelVisible && spaceSurfaceActive ? (
            <motion.aside
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className={[
                "col-start-1 row-start-1 flex min-h-0",
                "min-w-[248px] flex-col overflow-hidden",
                "border-r border-charcoal-border bg-charcoal-sidebar px-3 pb-2 pt-3 text-sm text-cream-muted",
              ].join(" ")}
            >
              {activeInvitation ? (
                <SpaceInvitationSidebar invitation={activeInvitation} />
              ) : (
                <SpacePanelContent key={activeSpace?.id} spaces={spaces} loading={loading} />
              )}
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <main
          key={activeInvitation?.id ?? activeTab?.id}
          className="relative col-start-2 row-start-1 min-h-0 min-w-0 overflow-hidden bg-charcoal-bg"
        >
          {activeInvitation ? (
            <SpaceInvitationView
              invitation={activeInvitation}
              error={error ?? ""}
              onRespond={respondToActiveInvitation}
            />
          ) : activeTab?.kind === "space" ? (
            detailRouteActive ? (
              <SpacePageFrame>
                <Outlet context={outletContext} />
              </SpacePageFrame>
            ) : (
              <Outlet context={outletContext} />
            )
          ) : (
            <Outlet context={outletContext} />
          )}
        </main>

        <footer className="col-span-full row-start-2 flex min-h-8 items-center border-t border-charcoal-border/45 bg-charcoal-bg px-2">
          <SpacesBottomBarToggle
            pressed={panelVisible}
            onClick={() => setPanelVisible((visible) => !visible)}
            title={panelVisible ? "Hide Spaces panel" : "Show Spaces panel"}
          >
            {panelVisible ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </SpacesBottomBarToggle>
          <div
            id={spacesBottomBarActionsId}
            className="ml-auto flex min-w-0 items-center justify-end gap-1"
          />
        </footer>

        <CreateSpaceDialog dialog={dialog} error={error ?? ""} />
      </div>
    </MotionConfig>
  );
}

