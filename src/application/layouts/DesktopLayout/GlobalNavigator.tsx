import { Renameable } from "@/features/navigation-names/Renameable";
import { useNavigationName, sectionNameKey } from "@/features/navigation-names/store";
import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { useNavigatorOrder } from "./useNavigatorOrder";
import { navigationMenuPrimaryIconClass } from "@/shared/ui";
import { routes } from "@/features/app-shell";
import { reportSystemError } from "@/features/activity";
import { useAuth } from "@/features/auth";
import {
  officialAppIdForNavigator,
  officialAppRoute,
  usePinnedNavigatorAppIds,
} from "@/features/apps";
import { useInboxStore } from "@/features/inbox";
import { preferredDefaultSpace, SpaceRowActions, useSpacesStore } from "@/features/spaces";
import {
  dockLeaves,
  useWorkspaceStore,
  WorkspaceAppIcon,
  workspaceSurfaceFromRoute,
  type NavigatorAppId,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import { useEffect, useMemo, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { GlobalSpaceSwitcher } from "./GlobalSpaceSwitcher";
import { FilesNavigatorDisclosure } from "./FilesNavigatorDisclosure";
import { InboxNavigatorDisclosure } from "./InboxNavigatorDisclosure";
import { isGlobalNavigatorApp } from "./navigatorAppPlacement";
import { SpaceToolsNavigator } from "./SpaceToolsNavigator";
import { NavigatorAppsSection } from "./NavigatorAppsSection";
import {
  NavigatorHeaderHomeButton,
  NavigatorHeaderDiscoverButton,
  NavigatorHeaderAgentsButton,
  NavigatorHeaderSearchButton,
} from "./NavigatorUtilityIsland";
import { NavigatorProfileBar } from "./NavigatorProfileBar";
import { ActivityMenu } from "./ActivityMenu";
import { NavigatorServerMenu } from "./NavigatorServerMenu";

import {
  navigatorRowClass,
  navigatorTitlebarStripClass,
  navigatorHierarchyIslandClass,
  navigatorHierarchyActionClass,
} from "./styles";
import {
  appNavigationFor,
  savedProviderNavigation,
  useAppNavigationStore,
} from "@/features/apps/appNavigation";
import { DownloadedAppNavigator } from "./DownloadedAppNavigator";
import { OpenAppViewsNavigator } from "./OpenAppViewsNavigator";

type NavigatorToolItem = {
  id: NavigatorAppId;
  label: string;
  path: string;
  disabled?: boolean;
};
const globalToolItems = {
  inbox: { id: "inbox", label: "Inbox", path: officialAppRoute("inbox") },
  agents: { id: "agents", label: "Agents", path: officialAppRoute("agents") },
  browser: { id: "browser", label: "Browser", path: officialAppRoute("browser") },
  files: { id: "files", label: "Files", path: officialAppRoute("files") },
  code: { id: "code", label: "Code", path: officialAppRoute("code") },
  terminal: { id: "terminal", label: "Terminal", path: officialAppRoute("terminal") },
  music: { id: "music", label: "Music", path: officialAppRoute("music") },
  media: { id: "media", label: "Media", path: officialAppRoute("media") },
} satisfies Record<string, NavigatorToolItem>;

export function GlobalNavigator(props: {
  profileAnchorRef: RefObject<HTMLButtonElement | null>;
  profileOpen: boolean;
  settingsOpen: boolean;
  suppressActiveTool?: boolean;
  onProfileClick: () => void;
  onSettingsClick: () => void;
  onStartWindowDrag?: (event: React.PointerEvent<HTMLElement>) => void;
  /** Present on desktop: drags (and double-click zooms) from the top band. */
  onTitlebarPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const location = useLocation();
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const personalAppsSpaceId = "";
  const pinnedAppIds = usePinnedNavigatorAppIds();
  const selectedAppIds = pinnedAppIds.filter((id) => !isGlobalNavigatorApp(id));
  const providerCache = useAppNavigationStore((state) => state.providerCache);
  const appNavigation = useAppNavigationStore((state) => state.entries);
  const inboxAccounts = useInboxStore((state) => state.accounts);
  // The rail marks what the workspace is actually showing, not the last thing
  // that was clicked, so it follows the focused pane's active tab.
  const storedActiveTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((candidate) => candidate.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;
  });
  const activeTab = props.suppressActiveTool ? null : storedActiveTab;
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const activeGroupKey = activeTab?.groupKey ?? null;
  const spaces = useSpacesStore((state) => state.spaces);
  const spacesLoading = useSpacesStore((state) => state.loading);
  const spacesError = useSpacesStore((state) => state.error);
  // The workspace is always scoped to a Space. Before Spaces load there is
  // nothing to scope to, so the store starts on a bootstrap scope and adopts
  // the account's default Space the moment one is available.
  const defaultSpaceId = preferredDefaultSpace(spaces)?.id;
  useEffect(() => {
    if (!defaultSpaceId) return;
    const validScopes = new Set(spaces.map((space) => `space:${space.id}`));
    useWorkspaceStore.getState().adoptDefaultScope(`space:${defaultSpaceId}`, validScopes);
  }, [defaultSpaceId, spaces]);
  useEffect(() => {
    if (!spacesError) return;
    reportSystemError({
      accountId,
      scope: "spaces:load",
      intent: "background",
      title: "Spaces could not be loaded",
      error: spacesError,
      target: { kind: "route", href: routes.spaces },
    });
  }, [accountId, spacesError]);
  const invitations = useSpacesStore((state) => state.invitations);
  const limits = useSpacesStore((state) => state.limits);
  const visibleSpaces = useMemo(
    () => spaces.filter((space) => !invitations.some((invite) => invite.space_id === space.id)),
    [invitations, spaces],
  );
  const canAddSpace = !limits || limits.unlimited_spaces || spaces.length < limits.space_limit;
  const activeSpaceId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice(6) : "";
  const activeRoute = activeTab?.route ?? `${location.pathname}${location.search}`;
  const routeSpaceId = spaceIdFromRoute(activeRoute);
  // Space-scoped tools keep their slots during the first frames after launch
  // or while a Space is loading; they become active once a real context exists.
  const scopedSpace =
    spaces.find((space) => space.id === routeSpaceId) ??
    spaces.find((space) => space.id === activeSpaceId) ??
    preferredDefaultSpace(spaces);
  const homePath = routes.home;
  const homeActive = activeTab?.surfaceId === "home" || activeRoute === routes.home;
  const agentsActive =
    activeGroupKey === "app:agents" || activeRoute.split(/[?#]/)[0] === "/apps/agents";
  const marketplaceActive = activeGroupKey === "tool:marketplace";
  const toolItemsById = new Map<NavigatorAppId, NavigatorToolItem>([
    ...Object.values(globalToolItems).map((item) => [item.id, item] as const),
    ...(["social", "journal", "planner", "library"] as const).map(
      (id) =>
        [
          id,
          {
            id,
            label: id === "library" ? "Storage" : id[0].toUpperCase() + id.slice(1),
            path: officialAppRoute(id),
          },
        ] as const,
    ),
  ]);
  const selectedTools = selectedAppIds.flatMap((id) => {
    const item = toolItemsById.get(id);
    return item ? [item] : [];
  });
  const sectionOrder = useNavigatorOrder(
    accountId,
    "sections",
    selectedTools.map((item) => item.id),
  );
  const orderedTools = sectionOrder.ids.flatMap((id) =>
    selectedTools.filter((item) => item.id === id),
  );
  const sectionDrag = usePointerReorder({
    scope: `navigator:${accountId}:sections`,
    axis: "y",
    hitArea: "header",
    getDrag: (id) => {
      const item = selectedTools.find((item) => item.id === id);
      return item ? { id, label: item.label } : null;
    },
    onDrop: (drag, target, after) => sectionOrder.move(drag.id, target, after),
    onKeyboardMove: sectionOrder.step,
  });

  const globalItems = [
    {
      id: "home",
      label: "Home",
      node: <NavigatorHeaderHomeButton path={homePath} active={homeActive} />,
    },
    {
      id: "discover",
      label: "Discover",
      node: <NavigatorHeaderDiscoverButton path={routes.discover} active={marketplaceActive} />,
    },
    {
      id: "agents",
      label: "Agents",
      node: <NavigatorHeaderAgentsButton path={officialAppRoute("agents")} active={agentsActive} />,
    },
  ];
  const globalOrder = useNavigatorOrder(
    accountId,
    "global",
    globalItems.map((item) => item.id),
  );
  const globalDrag = usePointerReorder({
    scope: `navigator:${accountId}:global`,
    axis: "y",
    hitArea: "header",
    getDrag: (id) => {
      const item = globalItems.find((item) => item.id === id);
      return item ? { id, label: item.label } : null;
    },
    onDrop: (item, target, after) => globalOrder.move(item.id, target, after),
    onKeyboardMove: globalOrder.step,
  });

  return (
    <nav
      className={cn(
        "relative z-20 flex h-full min-h-0 w-full select-none flex-col items-stretch [--navigation-primary-icon-slot:24px]",
        "overflow-hidden border-r border-charcoal-border bg-charcoal-workspace",
      )}
      aria-label="Primary"
      data-tour-target="navigation"
      onPointerDown={props.onStartWindowDrag}
    >
      {props.onTitlebarPointerDown ? (
        // The rail owns the titlebar band rather than being pushed below it, so
        // its right border runs the whole window height and the traffic-light
        // area stays a window-drag surface.
        <div
          className={navigatorTitlebarStripClass}
          onPointerDown={(event) => {
            event.stopPropagation();
            props.onTitlebarPointerDown?.(event);
          }}
        />
      ) : null}

      <div
        className="shrink-0 px-3 pb-1 pt-2"
        data-navigator-header="true"
        data-misty-window-drag-block="true"
      >
        <div className={navigatorHierarchyIslandClass} data-navigator-server-row="true">
          <NavigatorServerMenu onSettingsClick={props.onSettingsClick} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <NavigatorHeaderSearchButton className={navigatorHierarchyActionClass} />
            <ActivityMenu className={navigatorHierarchyActionClass} />
          </div>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-misty-window-drag-block="true"
      >
        <NavigatorSection label="Primary navigation" className="min-h-0 flex-1">
          <div
            {...globalDrag}
            className="grid w-full gap-1"
            aria-label="Global navigation"
            data-navigator-actions-row="true"
          >
            {globalOrder.ids.map((id) => (
              <div
                key={id}
                data-reorder-item={id}
                data-navigator-home-row={id === "home" ? "true" : undefined}
              >
                {globalItems.find((item) => item.id === id)?.node}
              </div>
            ))}
          </div>
          <section
            aria-label="Space"
            className="grid min-w-0 gap-1 pt-2"
            data-navigator-space-row="true"
          >
            <div className={navigatorHierarchyIslandClass} data-navigator-space-island="true">
              <div className="min-w-0 flex-1">
                <GlobalSpaceSwitcher
                  activeSpace={scopedSpace}
                  activeSpaceId={activeSpaceId}
                  canAddSpace={canAddSpace}
                  spaces={visibleSpaces}
                  userId={user?.id ?? ""}
                />
              </div>
              {scopedSpace ? (
                <SpaceRowActions
                  key={scopedSpace.id}
                  space={scopedSpace}
                  actionClassName={navigatorHierarchyActionClass}
                />
              ) : null}
            </div>
            <SpaceToolsNavigator
              key={scopedSpace?.id ?? "pending"}
              accountId={accountId}
              space={scopedSpace}
              activeRoute={activeRoute}
              loading={spacesLoading}
              error={Boolean(spacesError)}
            />
          </section>
          <NavigatorAppsSection accountId={accountId}>
            <div {...sectionDrag} className="grid min-w-0 gap-0.5">
              {orderedTools.map((item) => (
                <div key={item.id} data-reorder-item={item.id}>
                  {renderToolItem(item)}
                </div>
              ))}
            </div>
          </NavigatorAppsSection>
        </NavigatorSection>
      </div>

      <NavigatorProfileBar
        profileAnchorRef={props.profileAnchorRef}
        profileOpen={props.profileOpen}
        settingsOpen={props.settingsOpen}
        onProfileClick={props.onProfileClick}
        onSettingsClick={props.onSettingsClick}
      />
    </nav>
  );

  function toolIsActive(item: NavigatorToolItem): boolean {
    const appGroup = `app:${officialAppIdForNavigator(item.id)}`;
    return (
      !item.disabled &&
      !activeRoute.startsWith("/spaces/") &&
      workspaceSurfaceFromRoute(activeRoute)?.groupKey === appGroup
    );
  }

  function renderToolItem(item: NavigatorToolItem): ReactNode {
    const active = toolIsActive(item);
    if (item.id === "files")
      return (
        <FilesNavigatorDisclosure
          accountId={accountId}
          activeGroupKey={active ? "app:files" : null}
          activeRoute={activeRoute}
        />
      );
    const registration =
      !item.disabled &&
      item.id !== "agents" &&
      appNavigationFor(appNavigation, {
        accountId,
        spaceId: personalAppsSpaceId,
        appId: officialAppIdForNavigator(item.id),
        instanceId: activeTab?.id,
      });
    const retainedRegistration = registration;
    if (retainedRegistration)
      return (
        <DownloadedAppNavigator
          key={item.id}
          accountId={accountId}
          appId={item.id}
          label={item.label}
          active={active}
          activeRoute={activeRoute}
          items={retainedRegistration.items}
        />
      );

    if (!item.disabled && (item.id === "code" || item.id === "terminal")) {
      return (
        <DownloadedAppNavigator
          accountId={accountId}
          appId={item.id}
          label={item.label}
          active={active}
          activeRoute={activeRoute}
          items={[]}
        >
          <OpenAppViewsNavigator appId={item.id} />
        </DownloadedAppNavigator>
      );
    }

    if (
      !item.disabled &&
      ["browser", "social", "inbox", "planner", "journal", "library", "music", "media"].includes(
        item.id,
      )
    ) {
      const saved = savedProviderNavigation(providerCache, {
        accountId,
        spaceId: personalAppsSpaceId,
        appId: officialAppIdForNavigator(item.id),
      });
      const path = `/apps/${item.id}`;
      const items =
        saved?.items ??
        (item.id === "inbox"
          ? ["google", "microsoft"]
              .filter((id) => inboxAccounts.some((account) => account.provider === id))
              .map((id) => ({
                id,
                label: id === "google" ? "Gmail" : "Outlook",
                route: `${path}?provider=${id}`,
              }))
          : []);
      return (
        <DownloadedAppNavigator
          key={item.id}
          accountId={accountId}
          appId={item.id}
          label={item.label}
          active={active}
          activeRoute={activeRoute}
          items={items}
        />
      );
    }

    if (item.id === "inbox") {
      return (
        <InboxNavigatorDisclosure
          key={item.id}
          accountId={accountId}
          accounts={inboxAccounts}
          active={active}
          activeRoute={activeRoute}
          path={item.path}
        />
      );
    }

    return (
      <NavigatorLink
        accountId={accountId}
        key={item.id}
        appId={item.id}
        label={item.label}
        path={item.path}
        disabled={item.disabled}

        active={active}
      />
    );
  }
}

function spaceIdFromRoute(route: string): string {
  try {
    const parsed = new URL(route, "https://misty.local");
    const segments = parsed.pathname.split("/").filter(Boolean);
    const encodedSpaceId =
      segments[0] === "spaces" && segments[1] ? segments[1] : parsed.searchParams.get("space");
    return encodedSpaceId ? decodeURIComponent(encodedSpaceId) : "";
  } catch {
    return "";
  }
}

function NavigatorSection(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden", props.className)}
      aria-label={props.label}
    >
      <div
        className={cn(
          "misty-transient-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          "overscroll-contain",
        )}
        data-navigator-section-scroll={props.label.toLowerCase()}
      >
        <div
          className="grid content-start gap-2 px-3 pb-2"
          data-navigator-section-content={props.label.toLowerCase()}
        >
          {props.children}
        </div>
      </div>
    </section>
  );
}

function NavigatorLink(props: {
  accountId: string;
  appId: NavigatorAppId;
  label: string;
  path: string;
  active: boolean;
  disabled?: boolean;
  disabledReasonId?: string;
  reorderable?: boolean;
}) {
  const navigate = useNavigate();
  const label = useNavigationName(sectionNameKey(props.appId), props.label);
  const content = (
    <>
      <span className={navigationMenuPrimaryIconClass}>
        <WorkspaceAppIcon
          appId={props.appId}
          className={props.disabled ? "opacity-45 grayscale-[0.35]" : undefined}
          size="nav"
        />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (props.disabled) {
    return (
      <div
        className={cn(
          navigatorRowClass(false),
          "cursor-default text-cream-muted/55 hover:bg-transparent hover:text-cream-muted/55",
        )}
        data-reorder-header={props.reorderable === false ? undefined : "true"}
        data-reorder-handle={props.reorderable === false ? undefined : "true"}
        data-misty-window-drag-block="true"
        tabIndex={0}
        aria-disabled="true"
        aria-describedby={props.disabledReasonId}
        aria-label={label}
      >
        {content}
      </div>
    );
  }
  return (
    <Renameable nameKey={sectionNameKey(props.appId)} automatic={props.label}>
      <Link
        to={props.path}
        data-reorder-handle={props.reorderable === false ? undefined : "true"}
        data-reorder-header={props.reorderable === false ? undefined : "true"}
        data-misty-window-drag-block="true"
        title={props.reorderable === false ? undefined : "Drag to reorder · Alt+Shift+↑/↓"}
        className={navigatorRowClass(props.active)}
        aria-current={props.active ? "page" : undefined}
        aria-label={label}
        onClick={(event) => {
          const surface = workspaceSurfaceFromRoute(props.path);
          if (!surface) return;
          event.preventDefault();
          navigate(useWorkspaceStore.getState().openSurface(surface).route);
        }}
      >
        {content}
      </Link>
    </Renameable>
  );
}
