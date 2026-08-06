import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { Button, PermissionState } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { useAppStore } from "@/stores/app";
import { useExplorerStore } from "@/stores/explorer";
import {
  activeSpacesTab,
  defaultSpaceRoute,
  normalizeSpacesTabRoute,
  spacesTabsSessionKey,
  useSpacesTabsStore,
  type WorkspaceTabKind,
} from "@/stores/spaces/useSpacesTabsStore";
import { SpacePanelContent } from "./SpacePanelContent";
import { spacesBottomBarActionsId, SpacesBottomBarToggle } from "./SpacesBottomBar";
import { SpacesHeader } from "./SpacesHeader";
import { SpacesWorkspaceSurface } from "./SpacesWorkspaceSurface";
import { SpacePageFrame } from "./SpacePageLayout";
import { SpacesReconnectScreen } from "./SpacesReconnectScreen";
import { SpacesAppLoadingPlaceholder } from "./SpacesLoadingPlaceholder";
import { CreateSpaceDialog } from "../spacesShell/CreateSpaceDialog";
import { SpaceInvitationSidebar, SpaceInvitationView } from "../spacesShell/SpaceInvitationView";
import { useCreateSpaceDialog } from "../spacesShell/useCreateSpaceDialog";
import { useCreateSpaceRouteRequest } from "../spacesShell/useCreateSpaceRouteRequest";
import { readPanelVisible, writePanelVisible } from "../spacesShell/spacesShellStorage";
import { rememberSpaceSubpageRoute } from "../spacesShell/spaceSubpageMemory";
import { useSpacePanelRoute } from "./spacePanel/spacePanelRoute";
import type { SpacesShellOutletContext } from "../spacesShell/outletContext";
import { preferredMistySpace } from "../mistySpace";

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
    closeWorkspaceTab,
    reorderWorkspaceTabs,
    selectWorkspaceTab,
    updateActiveSpaceRoute,
    pruneTabSessions,
  } = useSpacesTabsStore(
    useShallow((state) => ({
      ensureTabSession: state.ensureSession,
      addWorkspaceTab: state.addTab,
      closeWorkspaceTab: state.closeTab,
      reorderWorkspaceTabs: state.reorderTabs,
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
  }, [load, user?.id]);
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
  useEffect(() => writePanelVisible(panelVisible), [panelVisible]);
  useEffect(() => {
    if (!accountId || !snapshotReady) return;
    const removed = pruneTabSessions(
      accountId,
      spaces.map((space) => space.id),
    );
    const homePath = useAppStore.getState().app?.environment.homeDir;
    if (!homePath) return;
    for (const tab of removed) {
      if (tab.kind === "file-manager")
        void useExplorerStore.getState().deleteWorkspace(tab.workspaceId, homePath);
    }
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
    // Tab selection does not navigate, so an active tool tab can legitimately
    // sit over the current Space URL. Only reconcile the URL when React Router
    // reports a new navigation; otherwise opening File Manager (or another
    // tool) would immediately create and activate a duplicate Space tab.
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

  const openTool = (kind: WorkspaceTabKind) => {
    if (!accountId || !activeSpace?.id) return;
    const tabId = addWorkspaceTab(
      accountId,
      activeSpace.id,
      kind,
      kind === "space" ? currentSpacesRoute : undefined,
    );
    if (!tabId) {
      useAppStore.getState().setMessage("This Space already has 16 open tabs.");
      return;
    }
    if (kind === "space") {
      const next = useSpacesTabsStore
        .getState()
        .sessions[spacesTabsSessionKey(accountId, activeSpace.id)]?.tabs.find(
          (tab) => tab.id === tabId && tab.kind === "space",
        );
      if (next?.kind === "space" && next.route !== currentSpacesRoute) {
        pendingTabRouteRef.current = next.route;
        navigate(next.route);
      }
    }
  };

  const selectTopLevelTab = (tabId: string) => {
    if (!accountId || !activeSpace?.id || tabId === activeTab?.id) return;
    const selected = tabSession?.tabs.find((tab) => tab.id === tabId);
    if (!selected) return;
    selectWorkspaceTab(accountId, activeSpace.id, tabId);
    if (selected.kind === "space" && selected.route !== currentSpacesRoute) {
      pendingTabRouteRef.current = selected.route;
      navigate(selected.route);
    }
  };

  const closeTopLevelTab = (tabId: string) => {
    if (!accountId || !activeSpace?.id) return;
    const wasActive = activeTab?.id === tabId;
    const closed = closeWorkspaceTab(accountId, activeSpace.id, tabId);
    if (closed?.kind === "file-manager") {
      const homePath = useAppStore.getState().app?.environment.homeDir;
      if (homePath) void useExplorerStore.getState().deleteWorkspace(closed.workspaceId, homePath);
    }
    if (!wasActive) return;
    const next = activeSpacesTab(
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey(accountId, activeSpace.id)],
    );
    if (next?.kind === "space" && next.route !== currentSpacesRoute) {
      pendingTabRouteRef.current = next.route;
      navigate(next.route);
    }
  };

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
          "misty-spaces-workbench grid h-full min-h-0",
          "grid-rows-[46px_minmax(0,1fr)_32px] overflow-hidden",
          "transition-[grid-template-columns] duration-300 ease-[var(--misty-ease-out)]",
        ].join(" ")}
        style={{
          gridTemplateColumns:
            panelVisible && spaceSurfaceActive
              ? "var(--misty-spaces-rail-width) minmax(0, 1fr)"
              : "0px minmax(0, 1fr)",
        }}
      >
        <div className="col-span-full row-start-1 min-w-0">
          <SpacesHeader
            session={tabSession}
            onOpenTool={openTool}
            onCloseTab={closeTopLevelTab}
            onReorderTab={(tabId, fromIndex, toIndex) => {
              if (accountId && activeSpace?.id)
                reorderWorkspaceTabs(accountId, activeSpace.id, tabId, fromIndex, toIndex);
            }}
            onSelectTab={selectTopLevelTab}
          />
        </div>

        <AnimatePresence initial={false}>
          {panelVisible && spaceSurfaceActive ? (
            <motion.aside
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className={[
                "misty-spaces-panel col-start-1 row-start-2 flex min-h-0",
                "min-w-[var(--misty-spaces-rail-width)] flex-col overflow-hidden",
                "border-r border-sidebar-border/60 px-3 pb-2 pt-3 text-sm text-sidebar-foreground",
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
          className="misty-spaces-canvas relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-hidden"
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
          ) : activeTab ? (
            <SpacesWorkspaceSurface tab={activeTab} />
          ) : (
            <Outlet context={outletContext} />
          )}
        </main>

        <footer className="col-span-full row-start-3 flex min-h-8 items-center border-t border-border/45 bg-background/70 px-2">
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
