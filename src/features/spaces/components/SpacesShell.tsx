import { useEffect, useRef, useState } from "react";
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
import { SpaceReferenceStatus } from "./SpaceReferenceStatus";
import { SpacesAppLoadingPlaceholder } from "./SpacesLoadingPlaceholder";
import { CreateSpaceDialog } from "../spacesShell/CreateSpaceDialog";
import { SpaceInvitationsNotice } from "../spacesShell/SpaceInvitationsNotice";
import { useCreateSpaceDialog } from "../spacesShell/useCreateSpaceDialog";
import { useCreateSpaceRouteRequest } from "../spacesShell/useCreateSpaceRouteRequest";
import { readPanelVisible, writePanelVisible } from "../spacesShell/spacesShellStorage";
import { rememberSpaceSubpageRoute } from "../spacesShell/spaceSubpageMemory";
import { useSpacePanelRoute } from "./spacePanel/spacePanelRoute";
import type { SpacesShellOutletContext } from "../spacesShell/outletContext";
import { AgentDock } from "@/features/agents/AgentDock";
import { agentTeammatesV1Enabled } from "@/features/agents/flags";
import {
  agentDockMaxWidth,
  agentDockMinWidth,
  agentDockWidthStorageKey,
  clampAgentDockWidth,
  isCompactAgentDock,
} from "@/features/agents/agentDockState";

export { SpacesIndexRedirect } from "../spacesShell/SpacesIndexRedirect";

export default function SpacesShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, transitioning } = useAuth();
  const accountId = user?.id ?? "";
  const currentSpacesRoute = `${location.pathname}${location.search}${location.hash}`;
  const pendingTabRouteRef = useRef<string | null>(null);
  const agentDockOpen =
    agentTeammatesV1Enabled() && new URLSearchParams(location.search).get("agentDock") === "1";
  const [panelVisible, setPanelVisible] = useState(readPanelVisible);
  const [agentDockWidth, setAgentDockWidth] = useState(420);
  const [compactAgentDock, setCompactAgentDock] = useState(() =>
    isCompactAgentDock(window.innerWidth),
  );
  const {
    spaces,
    invitations,
    loading,
    snapshotReady,
    referenceOnly,
    lastSyncedAt,
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
      lastSyncedAt: state.lastSyncedAt,
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
  const reconnect = () => void load({ force: true, accountId });

  const closeAgentDock = () => {
    const params = new URLSearchParams(location.search);
    params.delete("agentDock");
    navigate(`${location.pathname}${params.size ? `?${params.toString()}` : ""}${location.hash}`, {
      replace: true,
    });
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[aria-label="Space team"]')?.focus(),
    );
  };

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1099px)");
    const update = () => setCompactAgentDock(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!accountId || !activeSpace?.id) return;
    const key = agentDockWidthStorageKey(accountId, activeSpace.id);
    const saved = Number(window.localStorage.getItem(key));
    if (Number.isFinite(saved) && saved >= agentDockMinWidth && saved <= agentDockMaxWidth) {
      setAgentDockWidth(saved);
    }
  }, [accountId, activeSpace?.id]);
  useEffect(() => {
    if (!accountId || !activeSpace?.id) return;
    window.localStorage.setItem(
      agentDockWidthStorageKey(accountId, activeSpace.id),
      String(agentDockWidth),
    );
  }, [accountId, activeSpace?.id, agentDockWidth]);
  const beginAgentDockResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentDockWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setAgentDockWidth(clampAgentDockWidth(startWidth + startX - moveEvent.clientX));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
            panelVisible && activeTab?.kind === "space"
              ? `var(--misty-spaces-rail-width) minmax(0, 1fr) ${agentDockOpen && activeSpace && !compactAgentDock ? `${agentDockWidth}px` : "0px"}`
              : `0px minmax(0, 1fr) ${agentDockOpen && activeSpace && !compactAgentDock ? `${agentDockWidth}px` : "0px"}`,
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
          {panelVisible && activeTab?.kind === "space" ? (
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
              <SpacePanelContent
                key={activeSpace?.id}
                spaces={spaces}
                loading={loading}
                notices={
                  <SpaceInvitationsNotice
                    invitations={invitations}
                    onRespond={(id, accept) => void respondInvite(id, accept)}
                  />
                }
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <main
          key={activeTab?.id}
          className="misty-spaces-canvas relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-hidden"
        >
          {activeTab?.kind === "space" ? (
            detailRouteActive ? (
              <SpacePageFrame>
                <Outlet context={outletContext} />
              </SpacePageFrame>
            ) : (
              <Outlet context={outletContext} />
            )
          ) : activeTab ? (
            <SpacesWorkspaceSurface tab={activeTab} />
          ) : null}
        </main>

        <AnimatePresence initial={false}>
          {agentDockOpen && activeSpace && activeTab?.kind === "space" && !referenceOnly ? (
            <motion.aside
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              className={[
                compactAgentDock
                  ? "fixed bottom-8 right-0 top-[46px] z-40 max-w-[calc(100vw-32px)]"
                  : "relative col-start-3 row-start-2 min-h-0 min-w-0",
                "overflow-hidden",
                "border-l border-border/60 bg-background",
                "shadow-[-12px_0_28px_-24px_rgba(0,0,0,0.45)]",
              ].join(" ")}
              style={compactAgentDock ? { width: agentDockWidth } : undefined}
            >
              <div
                className="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize touch-none hover:bg-primary/20"
                role="separator"
                aria-label="Resize Agent panel"
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={beginAgentDockResize}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  setAgentDockWidth((width) =>
                    clampAgentDockWidth(width + (event.key === "ArrowLeft" ? 20 : -20)),
                  );
                }}
              />
              <AgentDock
                context={{
                  surface: "space",
                  label: [
                    activeSpace.name,
                    spaceContextLabel(panelRoute),
                    new URLSearchParams(location.search).get("task") ? "Task open" : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  spaceId: activeSpace.id,
                  spaceName: activeSpace.name,
                  section: panelRoute.section,
                  taskId: new URLSearchParams(location.search).get("task") ?? undefined,
                }}
                onClose={closeAgentDock}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <footer className="col-span-full row-start-3 flex min-h-8 items-center border-t border-border/45 bg-background/70 px-2">
          <SpacesBottomBarToggle
            pressed={panelVisible}
            onClick={() => setPanelVisible((visible) => !visible)}
            title={panelVisible ? "Hide Spaces panel" : "Show Spaces panel"}
          >
            {panelVisible ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </SpacesBottomBarToggle>
          {referenceOnly ? (
            <SpaceReferenceStatus {...{ lastSyncedAt, loading }} onReconnect={reconnect} />
          ) : null}
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

function spaceContextLabel(route: ReturnType<typeof useSpacePanelRoute>): string {
  if (route.section === "planner") {
    if (route.plannerSection === "agenda") return "Agenda";
    if (route.plannerSection === "roadmaps") return "Roadmap";
    return "Planner";
  }
  if (route.section === "notes" || route.section === "drawings") return "Journal";
  return route.section.charAt(0).toUpperCase() + route.section.slice(1);
}
