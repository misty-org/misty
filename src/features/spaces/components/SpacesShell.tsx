import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { Button, PermissionState } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { ChromeTabStrip } from "@/features/workspace";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import {
  activeSpacesTab,
  normalizeSpacesTabRoute,
  useSpacesTabsStore,
} from "@/stores/spaces/useSpacesTabsStore";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { SpacePanelContent } from "./SpacePanelContent";
import { spacesBottomBarActionsId, SpacesBottomBarToggle } from "./SpacesBottomBar";
import { SpaceManagementNavigation } from "./SpaceManagementNavigation";
import { SpacePageFrame } from "./SpacePageLayout";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpacesAppLoadingPlaceholder } from "./SpacesLoadingPlaceholder";
import { CreateSpaceDialog } from "../spacesShell/CreateSpaceDialog";
import { SpaceInvitationsNotice } from "../spacesShell/SpaceInvitationsNotice";
import { useCreateSpaceDialog } from "../spacesShell/useCreateSpaceDialog";
import { readPanelVisible, writePanelVisible } from "../spacesShell/spacesShellStorage";
import { useSpacePanelRoute } from "./spacePanel/spacePanelRoute";
import type { SpacesShellOutletContext } from "../spacesShell/outletContext";

export { SpacesIndexRedirect } from "../spacesShell/SpacesIndexRedirect";

export default function SpacesShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, transitioning } = useAuth();
  const accountId = user?.id ?? "";
  const currentSpacesRoute = `${location.pathname}${location.search}${location.hash}`;
  const pendingTabRouteRef = useRef<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(readPanelVisible);
  const {
    spaces,
    invitations,
    limits,
    loading,
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
      limits: state.limits,
      loading: state.loading,
      error: state.error,
      load: state.load,
      createSpace: state.createSpace,
      respondInvite: state.respondInvite,
      setViewingSpace: state.setViewingSpace,
      clearError: state.clearError,
    })),
  );
  const { tabSession, ensureTabSession, addBlankTab, closeTab, reorderTabs, selectTab, updateTab } =
    useSpacesTabsStore(
      useShallow((state) => ({
        tabSession: accountId ? state.sessions[accountId] : undefined,
        ensureTabSession: state.ensureSession,
        addBlankTab: state.addBlankTab,
        closeTab: state.closeTab,
        reorderTabs: state.reorderTabs,
        selectTab: state.selectTab,
        updateTab: state.updateActiveTabRoute,
      })),
    );
  const dialog = useCreateSpaceDialog({ createSpace, clearError });
  const panelRoute = useSpacePanelRoute();
  const activeSpace = spaces.find((space) => space.id === panelRoute.activeSpaceId);
  const activeTab = activeSpacesTab(tabSession);
  const visibleTabs = useMemo(
    () => spacesTabDescriptors(tabSession?.tabs ?? [], spaces),
    [spaces, tabSession?.tabs],
  );

  const routeParts = location.pathname.split("/").filter(Boolean);
  const detailRouteActive = routeParts[0] === "spaces" && routeParts.length >= 3;

  useEffect(() => {
    if (!user) return;
    void load();
    // Re-fires on account switch so Spaces reloads for the new account
    // instead of leaving whatever was last fetched (or was in flight) for
    // the previous one sitting in the shared store.
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
    if (!accountId) return;
    const normalizedRoute = normalizeSpacesTabRoute(currentSpacesRoute);
    const currentSession = useSpacesTabsStore.getState().sessions[accountId];
    if (!currentSession?.tabs.length) {
      ensureTabSession(accountId, normalizedRoute);
      return;
    }

    const currentActiveTab = activeSpacesTab(currentSession);
    const pendingRoute = pendingTabRouteRef.current;
    if (pendingRoute) {
      if (normalizedRoute !== pendingRoute) return;
      pendingTabRouteRef.current = null;
    }

    if (normalizedRoute === "/spaces" && currentActiveTab?.route !== "/spaces") {
      pendingTabRouteRef.current = currentActiveTab?.route ?? null;
      if (currentActiveTab) navigate(currentActiveTab.route, { replace: true });
      return;
    }
    updateTab(accountId, normalizedRoute);
  }, [accountId, currentSpacesRoute, ensureTabSession, navigate, updateTab]);

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
        className="misty-spaces-workbench grid h-full min-h-0 grid-rows-[46px_minmax(0,1fr)_32px] overflow-hidden transition-[grid-template-columns] duration-300 ease-[var(--misty-ease-out)]"
        style={{
          gridTemplateColumns: panelVisible
            ? "var(--misty-spaces-rail-width) minmax(0, 1fr)"
            : "0px minmax(0, 1fr)",
        }}
      >
        <div className="col-span-full row-start-1 min-w-0 border-b border-border/45 bg-background">
          <ChromeTabStrip
            tabs={visibleTabs}
            activeTabId={activeTab?.id ?? ""}
            ariaLabel="Open Spaces"
            canCloseTab={() => true}
            onAddTab={() => {
              if (!accountId) return;
              const beforeCount =
                useSpacesTabsStore.getState().sessions[accountId]?.tabs.length ?? 0;
              addBlankTab(accountId);
              const nextSession = useSpacesTabsStore.getState().sessions[accountId];
              if (!nextSession || nextSession.tabs.length === beforeCount) return;
              if (currentSpacesRoute === "/spaces") {
                pendingTabRouteRef.current = null;
                return;
              }
              pendingTabRouteRef.current = "/spaces";
              navigate("/spaces");
            }}
            onCloseTab={(tab) => {
              if (!accountId) return;
              const before = useSpacesTabsStore.getState().sessions[accountId];
              const wasActive = before?.activeTabId === tab.id;
              closeTab(accountId, tab.id);
              if (!wasActive) return;
              const nextActive = activeSpacesTab(useSpacesTabsStore.getState().sessions[accountId]);
              if (!nextActive) return;
              if (nextActive.route === currentSpacesRoute) {
                pendingTabRouteRef.current = null;
                return;
              }
              pendingTabRouteRef.current = nextActive.route;
              navigate(nextActive.route);
            }}
            onReorderTab={(tabId, fromIndex, toIndex) => {
              if (accountId) reorderTabs(accountId, tabId, fromIndex, toIndex);
            }}
            onSelectTab={(tabId) => {
              if (!accountId || tabId === activeTab?.id) return;
              const selected = tabSession?.tabs.find((tab) => tab.id === tabId);
              if (!selected) return;
              selectTab(accountId, tabId);
              if (selected.route === currentSpacesRoute) {
                pendingTabRouteRef.current = null;
                return;
              }
              pendingTabRouteRef.current = selected.route;
              navigate(selected.route);
            }}
          />
        </div>

        <AnimatePresence initial={false}>
          {panelVisible ? (
            <motion.aside
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="misty-spaces-panel col-start-1 row-start-2 flex min-h-0 min-w-[var(--misty-spaces-rail-width)] flex-col overflow-hidden border-r border-sidebar-border/60 px-3 pb-2 pt-3 text-sm text-sidebar-foreground"
            >
              <SpacePanelContent
                key={activeTab?.id}
                spaces={spaces}
                limits={limits}
                loading={loading}
                onAddSpace={dialog.start}
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
          {detailRouteActive ? (
            <div className="grid h-full min-h-0 grid-rows-[48px_minmax(0,1fr)]">
              <header className="flex min-w-0 items-center border-b border-border/60 bg-background px-3">
                <SpaceSectionNavigation
                  spaceId={panelRoute.activeSpaceId}
                  section={panelRoute.section}
                />
                <SpaceManagementNavigation space={activeSpace} section={panelRoute.section} />
              </header>
              <SpacePageFrame>
                <Outlet context={outletContext} />
              </SpacePageFrame>
            </div>
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

function spacesTabDescriptors(tabs: Array<{ id: string; route: string }>, spaces: Space[]) {
  const spaceIds = tabs.map((tab) => spaceIdFromTabRoute(tab.route));
  const duplicateCounts = new Map<string, number>();
  spaceIds.forEach((spaceId) => {
    if (spaceId) duplicateCounts.set(spaceId, (duplicateCounts.get(spaceId) ?? 0) + 1);
  });

  return tabs.map((tab, index) => {
    const spaceId = spaceIds[index];
    const space = spaces.find((candidate) => candidate.id === spaceId);
    const section = sectionFromTabRoute(tab.route);
    const title =
      tab.route === "/spaces"
        ? "New tab"
        : space
          ? duplicateCounts.get(space.id)! > 1
            ? `${space.name} · ${spaceSectionLabel(section)}`
            : space.name
          : "Space";
    return {
      id: tab.id,
      title,
      path: tab.route,
      paneId: tab.id,
    };
  });
}

function spaceIdFromTabRoute(route: string): string {
  const parts = route.split(/[/?#]/).filter(Boolean);
  if (parts[0] !== "spaces" || !parts[1]) return "";
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return "";
  }
}

function sectionFromTabRoute(route: string): string {
  const section = route.split(/[/?#]/).filter(Boolean)[2] ?? "chat";
  return section === "tasks" ? "planner" : section;
}

function spaceSectionLabel(section: string): string {
  if (section === "notes" || section === "drawings") return "Journal";
  if (section === "library") return "Library";
  if (section === "planner") return "Planner";
  if (section === "members") return "Members";
  if (section === "settings") return "Settings";
  return "Chat";
}
