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
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces";
import {
  dockLeaves,
  useWorkspaceStore,
  WorkspaceAppIcon,
  workspaceSurfaceFromRoute,
  type NavigatorAppId,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import { useEffect, useMemo, type ReactNode, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import { AgentsNavigatorDisclosure } from "./AgentsNavigatorDisclosure";
import { FilesNavigatorDisclosure } from "./FilesNavigatorDisclosure";
import { GlobalSpaceSwitcher } from "./GlobalSpaceSwitcher";
import { InboxNavigatorDisclosure } from "./InboxNavigatorDisclosure";
import { JournalNavigatorDisclosure } from "./JournalNavigatorDisclosure";
import { LibraryNavigatorDisclosure } from "./LibraryNavigatorDisclosure";
import { NavigatorAppsSection } from "./NavigatorAppsSection";
import {
  NavigatorHeaderHomeButton,
  NavigatorHeaderDiscoverButton,
  NavigatorHeaderSearchButton,
} from "./NavigatorUtilityIsland";
import { NavigatorProfileBar } from "./NavigatorProfileBar";
import { PlannerNavigatorDisclosure } from "./PlannerNavigatorDisclosure";
import { SocialNavigatorDisclosure } from "./SocialNavigatorDisclosure";
import { navigatorRowClass, navigatorTitlebarStripClass } from "./styles";
import { appNavigationFor, useAppNavigationStore } from "@/features/apps/appNavigation";
import { DownloadedAppNavigator } from "./DownloadedAppNavigator";

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
  const selectedAppIds = usePinnedNavigatorAppIds();
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
    useWorkspaceStore.getState().adoptDefaultScope(`space:${defaultSpaceId}`);
  }, [defaultSpaceId]);
  useEffect(() => {
    if (!spacesError) return;
    reportSystemError({
      accountId,
      scope: "spaces:load",
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
  const activeSpaceSection = spaceSectionFromRoute(activeRoute);
  const routeSpaceId = spaceIdFromRoute(activeRoute);
  // Space-scoped tools keep their slots during the first frames after launch
  // or while a Space is loading; they become active once a real context exists.
  const scopedSpace =
    spaces.find((space) => space.id === routeSpaceId) ??
    spaces.find((space) => space.id === activeSpaceId) ??
    preferredDefaultSpace(spaces);
  const homePath = scopedSpace
    ? `/spaces/${encodeURIComponent(scopedSpace.id)}/home`
    : routes.spaces;
  const homeActive = Boolean(
    scopedSpace && routeSpaceId === scopedSpace.id && activeSpaceSection === "home",
  );
  const marketplaceActive = activeGroupKey === "tool:marketplace";
  const spaceToolContext = scopedSpace ?? (routeSpaceId ? { id: routeSpaceId } : undefined);
  const contextualTools: NavigatorToolItem[] = spaceToolContext
    ? spaceToolItems(spaceToolContext, user?.id ?? "")
        .filter(({ id }) => !scopedSpace || canShowSpaceTool(scopedSpace, id))
        .map((item) => ({ ...item, disabled: !scopedSpace }))
    : spaceToolItems({ id: "pending" }, user?.id ?? "").map((item) => ({
        ...item,
        path: routes.spaces,
        disabled: true,
      }));
  const toolItemsById = new Map<NavigatorAppId, NavigatorToolItem>([
    ...Object.values(globalToolItems).map((item) => [item.id, item] as const),
    ...contextualTools.map((item) => [item.id, item] as const),
  ]);
  const selectedTools = selectedAppIds.flatMap((id) => {
    const item = toolItemsById.get(id);
    return item ? [item] : [];
  });
  const hasUnavailableSpaceApps = !scopedSpace && selectedAppIds.some((id) => isSpaceToolId(id));
  const spaceStatusId = "navigator-space-status";

  return (
    <nav
      className={cn(
        "relative z-20 flex h-full min-h-0 w-full select-none flex-col items-stretch",
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

      <div className="grid shrink-0 select-none gap-1 px-3 py-2" data-navigator-header="true">
        <div
          className="flex h-9 w-full min-w-0 items-center justify-between gap-1"
          data-navigator-space-row="true"
        >
          <GlobalSpaceSwitcher
            activeSpace={scopedSpace}
            activeSpaceId={activeSpaceId}
            canAddSpace={canAddSpace}
            spaces={visibleSpaces}
            userId={user?.id ?? ""}
          />
          <NavigatorHeaderSearchButton />
        </div>
        <div
          className="grid w-full gap-1"
          aria-label="Workspace actions"
          data-navigator-actions-row="true"
        >
          <NavigatorHeaderHomeButton path={homePath} active={homeActive} />
          <NavigatorHeaderDiscoverButton path={routes.discover} active={marketplaceActive} />
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-misty-window-drag-block="true"
      >
        <NavigatorSection label="Primary navigation" last className="min-h-0 flex-1">
          <NavigatorAppsSection accountId={accountId}>
            {hasUnavailableSpaceApps ? (
              <NavigatorSpaceStatus
                id={spaceStatusId}
                loading={spacesLoading}
                error={Boolean(spacesError)}
              />
            ) : null}
            {selectedTools.map(renderToolItem)}
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
    return !item.disabled && activeGroupKey === `app:${officialAppIdForNavigator(item.id)}`;
  }

  function renderToolItem(item: NavigatorToolItem): ReactNode {
    const active = toolIsActive(item);
    const registration =
      !item.disabled &&
      appNavigationFor(appNavigation, {
        accountId,
        spaceId: scopedSpace?.id,
        appId: officialAppIdForNavigator(item.id),
        instanceId: activeTab?.id,
      });
    if (registration)
      return (
        <DownloadedAppNavigator
          key={item.id}
          accountId={accountId}
          appId={item.id}
          label={item.label}
          active={active}
          activeRoute={activeRoute}
          items={registration.items}
        />
      );

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

    if (item.id === "agents") {
      return (
        <AgentsNavigatorDisclosure
          key={item.id}
          accountId={accountId}
          active={active}
          activeRoute={activeRoute}
          path={item.path}
        />
      );
    }

    if (item.id === "social" && !item.disabled && spaceToolContext) {
      return (
        <SocialNavigatorDisclosure
          key={item.id}
          accountId={accountId}
          spaceId={spaceToolContext.id}
          active={active}
          activeRoute={activeRoute}
          path={item.path}
        />
      );
    }

    if (item.id === "journal" && !item.disabled && spaceToolContext) {
      return (
        <JournalNavigatorDisclosure
          key={item.id}
          accountId={accountId}
          spaceId={spaceToolContext.id}
          active={active}
          activeRoute={activeRoute}
          path={item.path}
        />
      );
    }

    if (item.id === "planner" && !item.disabled && spaceToolContext) {
      return (
        <PlannerNavigatorDisclosure
          key={item.id}
          accountId={accountId}
          spaceId={spaceToolContext.id}
          active={active}
          activeRoute={activeRoute}
          path={item.path}
        />
      );
    }

    if (item.id === "files") {
      return (
        <FilesNavigatorDisclosure
          key={item.id}
          accountId={accountId}
          activeGroupKey={activeGroupKey}
          activeRoute={activeRoute}
        />
      );
    }

    if (item.id === "library" && !item.disabled && spaceToolContext) {
      return (
        <LibraryNavigatorDisclosure
          key={item.id}
          accountId={accountId}
          spaceId={spaceToolContext.id}
          active={active}
          activeRoute={activeRoute}
          path={item.path}
        />
      );
    }

    return (
      <NavigatorLink
        key={item.id}
        appId={item.id}
        label={item.label}
        path={item.path}
        disabled={item.disabled}
        disabledReasonId={item.disabled ? spaceStatusId : undefined}
        active={active}
      />
    );
  }
}

type SpaceToolId = "journal" | "planner" | "social" | "library";

function spaceToolItems(space: { id: string }, accountId: string) {
  return [
    {
      id: "social" as const,
      label: "Social",
      path: officialAppRoute("chat", space.id, accountId),
    },
    {
      id: "journal" as const,
      label: "Journal",
      path: officialAppRoute("journal", space.id, accountId),
    },
    {
      id: "planner" as const,
      label: "Planner",
      path: officialAppRoute("planner", space.id, accountId),
    },
    {
      id: "library" as const,
      label: "Library",
      path: officialAppRoute("library", space.id, accountId),
    },
  ];
}

function canShowSpaceTool(
  space: { permissions?: Record<string, boolean> },
  id: SpaceToolId,
): boolean {
  if (id === "social" && space.permissions?.["messages.read"] === false) return false;
  if (id === "planner" && space.permissions?.["tasks.view"] === false) return false;
  if (id === "library" && space.permissions?.["library.view"] === false) return false;
  return true;
}

function spaceSectionFromRoute(route: string): string {
  try {
    return new URL(route, "https://misty.local").pathname.split("/").filter(Boolean)[2] ?? "";
  } catch {
    return "";
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

function isSpaceToolId(id: string): id is SpaceToolId {
  return id === "journal" || id === "planner" || id === "social" || id === "library";
}

function NavigatorSpaceStatus(props: { id: string; loading: boolean; error: boolean }) {
  if (props.error) {
    return (
      <span id={props.id} className="sr-only">
        Space apps are unavailable. Open Activity for details.
      </span>
    );
  }

  return (
    <p
      id={props.id}
      className="mx-2.5 rounded-md bg-charcoal-bg px-2.5 py-2 text-xs leading-relaxed text-cream-muted"
      role="status"
    >
      {props.loading ? "Loading Space apps…" : "Choose or create a Space to use these apps."}
    </p>
  );
}

function NavigatorSection(props: {
  label: string;
  children: ReactNode;
  className?: string;
  /** The bottom-most section, which scrolls behind the floating account dock. */
  last?: boolean;
}) {
  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden pt-1", props.className)}
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
          className={cn("grid content-start gap-3 px-3", props.last && "pb-16")}
          data-navigator-section-content={props.label.toLowerCase()}
        >
          {props.children}
        </div>
      </div>
    </section>
  );
}

function NavigatorLink(props: {
  appId: NavigatorAppId;
  label: string;
  path: string;
  active: boolean;
  disabled?: boolean;
  disabledReasonId?: string;
}) {
  const content = (
    <>
      <span className={navigationMenuPrimaryIconClass}>
        <WorkspaceAppIcon
          appId={props.appId}
          className={props.disabled ? "opacity-45 grayscale-[0.35]" : undefined}
          size="nav"
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </>
  );
  if (props.disabled) {
    return (
      <div
        className={cn(
          navigatorRowClass(false),
          "cursor-default text-cream-muted/55 hover:bg-transparent hover:text-cream-muted/55",
        )}
        aria-disabled="true"
        aria-describedby={props.disabledReasonId}
        aria-label={props.label}
      >
        {content}
      </div>
    );
  }
  return (
    <Link
      to={props.path}
      onClick={() => {
        const surface = workspaceSurfaceFromRoute(props.path);
        if (surface) {
          useWorkspaceStore.getState().openSurface(surface);
        }
      }}
      className={navigatorRowClass(props.active)}
      aria-current={props.active ? "page" : undefined}
      aria-label={props.label}
    >
      {content}
    </Link>
  );
}
