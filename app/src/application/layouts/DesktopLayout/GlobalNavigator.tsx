import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import { routes } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import { useGlobalSearchStore } from "@/features/global-search";
import {
  canOpenMistySpaceSection,
  preferredMistySpace,
  GlobalCreateSpaceDialog,
  rememberedJournalRoute,
  rememberedPlannerRoute,
  SpaceAvatar,
  SpaceRowActions,
  spaceDestination,
  spaceLandingRoute,
  useSpacesStore,
} from "@/features/spaces";
import {
  dockLeaves,
  dockWidgetRegistry,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { isWebBuild } from "@/shared/platform/buildTarget";
import { cn } from "@/shared/ui";
import {
  ArrowLeftRight,
  BookOpenText,
  Blocks,
  Bot,
  CheckSquare2,
  Code2,
  FolderOpen,
  Globe2,
  House,
  Inbox,
  MessagesSquare,
  Notebook,
  Plus,
  Search,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, type ReactNode, type RefObject } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { DeploymentMenu } from "./DeploymentMenu";
import { NavigatorProfileBar } from "./NavigatorProfileBar";
import { navigatorTitlebarStripClass } from "./styles";

type NavigatorToolItem = {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  disabled?: boolean;
};
type ToolGroupId = "work" | "explore" | "build";

const toolItems: NavigatorToolItem[] = [
  { id: "inbox", label: "Inbox", path: routes.inbox, icon: Inbox },
  { id: "browser", label: "Browser", path: routes.browser, icon: Globe2 },
  { id: "terminal", label: "Terminal", path: routes.terminal, icon: TerminalSquare },
  { id: "code", label: "Code", path: routes.code, icon: Code2 },
  { id: "files", label: "Files", path: routes.files, icon: FolderOpen },
  { id: "transfers", label: "Transfers", path: routes.transfers, icon: ArrowLeftRight },
  { id: "agents", label: "Agents", path: routes.agents, icon: Bot },
];

export function GlobalNavigator(props: {
  collapsed: boolean;
  mistyLogoSource: string | null;
  profileAnchorRef: RefObject<HTMLButtonElement | null>;
  profileOpen: boolean;
  settingsOpen: boolean;
  onProfileClick: () => void;
  onSettingsClick: () => void;
  onStartWindowDrag?: (event: React.PointerEvent<HTMLElement>) => void;
  /** Present on desktop: drags (and double-click zooms) from the top band. */
  onTitlebarPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  // The rail marks what the workspace is actually showing, not the last thing
  // that was clicked, so it follows the focused pane's active tab.
  const activeTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((candidate) => candidate.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;
  });
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const activeGroupKey = activeTab?.groupKey ?? null;
  const spaces = useSpacesStore((state) => state.spaces);
  // The workspace is always scoped to a Space. Before Spaces load there is
  // nothing to scope to, so the store starts on a bootstrap scope and adopts
  // Misty — the home Space — the moment one is available.
  const defaultSpaceId = preferredMistySpace(spaces)?.id;
  useEffect(() => {
    if (!defaultSpaceId) return;
    useWorkspaceStore.getState().adoptDefaultScope(`space:${defaultSpaceId}`);
  }, [defaultSpaceId]);
  const invitations = useSpacesStore((state) => state.invitations);
  const limits = useSpacesStore((state) => state.limits);
  const activityItems = useActivityStore((state) => state.allItems);
  const visibleSpaces = useMemo(
    () => spaces.filter((space) => !invitations.some((invite) => invite.space_id === space.id)),
    [invitations, spaces],
  );
  const canAddSpace = !limits || limits.unlimited_spaces || spaces.length < limits.space_limit;
  const activeSpaceId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice(6) : "";
  // Space-scoped tools keep their slots during the first frames after launch
  // or while a Space is loading; they become active once a real context exists.
  const scopedSpace =
    spaces.find((space) => space.id === activeSpaceId) ?? preferredMistySpace(spaces);
  const activeRoute = activeTab?.route ?? location.pathname;
  const activeSpaceSection = spaceSectionFromRoute(activeRoute);
  const routeSpaceId = spaceIdFromRoute(activeRoute);
  const spaceToolContext = scopedSpace ?? (routeSpaceId ? { id: routeSpaceId } : undefined);
  const contextualTools = spaceToolContext
    ? spaceToolItems(spaceToolContext, user?.id ?? "")
        .filter(({ id }) => !scopedSpace || canShowSpaceTool(scopedSpace, id))
        .map((item) => ({ ...item, disabled: !scopedSpace }))
    : spaceToolItems({ id: "pending" }, user?.id ?? "").map((item) => ({
        ...item,
        path: routes.spaces,
        disabled: true,
      }));
  const toolsByGroup = toolGroups.map(({ id, label }) => ({
    id,
    label,
    items: [
      ...contextualTools.filter((item) => spaceToolGroup[item.id as SpaceToolId] === id),
      ...toolItems.filter((item) => globalToolGroup[item.id] === id),
    ],
  }));

  const openHomeTab = () => {
    const tab = useWorkspaceStore.getState().openSurface({
      surfaceId: "home",
      groupKey: "tool:home",
      title: "Home",
      route: routes.home,
      state: dockWidgetRegistry.get("home").create(),
    });
    if (`${location.pathname}${location.search}` !== tab.route) navigate(tab.route);
  };

  const shortcuts = (
    <>
      <button
        type="button"
        className={navigatorShortcutClass(activeGroupKey === "tool:home")}
        onClick={openHomeTab}
        aria-current={activeGroupKey === "tool:home" ? "page" : undefined}
        aria-label="Home"
        title="Home"
      >
        <House size={18} strokeWidth={1.75} />
      </button>
      <NavLink
        to={routes.extensions}
        className={navigatorShortcutClass(activeGroupKey === "tool:extensions")}
        aria-current={activeGroupKey === "tool:extensions" ? "page" : undefined}
        aria-label="Extensions"
        title="Extensions"
      >
        <Blocks size={18} strokeWidth={1.75} />
      </NavLink>
      <button
        type="button"
        className={navigatorShortcutClass(false)}
        onClick={() => {
          useGlobalSearchStore.getState().activateLauncher();
          window.setTimeout(
            () =>
              document
                .querySelector<HTMLInputElement>("[data-global-misty-launcher-input]")
                ?.focus(),
            0,
          );
        }}
        aria-label="Search"
        title="Search (⌘K)"
      >
        <Search size={18} strokeWidth={1.75} />
      </button>
    </>
  );

  return (
    <nav
      className={cn(
        "relative z-20 flex h-full min-h-0 w-full select-none flex-col overflow-hidden border-r border-charcoal-border bg-charcoal-workspace",
        props.collapsed ? "items-center" : "items-stretch",
      )}
      aria-label="Primary"
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
        className={cn(
          "flex h-[58px] shrink-0 select-none items-center",
          props.collapsed ? "justify-center px-2" : "gap-1 px-3",
        )}
      >
        <DeploymentMenu
          collapsed={props.collapsed}
          mistyLogoSource={props.mistyLogoSource}
          onConnectServer={props.onSettingsClick}
        />
        {props.collapsed ? null : (
          <div
            className="ml-auto flex shrink-0 items-center gap-2"
            data-misty-window-drag-block="true"
          >
            {shortcuts}
          </div>
        )}
      </div>

      {props.collapsed ? (
        <div
          className="grid shrink-0 justify-items-center gap-2 px-2 pt-2"
          data-misty-window-drag-block="true"
        >
          {shortcuts}
        </div>
      ) : null}

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-misty-window-drag-block="true"
      >
        <NavigatorSection
          label="Spaces"
          collapsed={props.collapsed}
          className="max-h-[42%] shrink-0"
        >
          {visibleSpaces.map((space) => {
            const active = activeScopeKey === `space:${space.id}`;
            const unread = unreadActivityCountForSpace(activityItems, space.id);
            return (
              <div key={space.id} className="group/space-row relative min-w-0">
                <Link
                  to={spaceLandingRoute(space.id, user?.id)}
                  onClick={() => {
                    useWorkspaceStore.getState().setScope(`space:${space.id}`);
                  }}
                  className={cn(
                    navigatorRowClass(active, props.collapsed),
                    // Room for the three hover actions. The name truncates
                    // under them rather than being hidden.
                    !props.collapsed && "pr-[94px]",
                  )}
                  aria-current={active ? "page" : undefined}
                  aria-label={space.name}
                  title={space.name}
                >
                  <span className="relative grid size-7 shrink-0 place-items-center">
                    <SpaceAvatar
                      space={space}
                      className="size-6 rounded-full border-0 bg-transparent"
                    />
                    {unread > 0 ? (
                      <span className="absolute -right-1 -top-1 size-2 rounded-full bg-notification-red ring-2 ring-charcoal-workspace" />
                    ) : null}
                  </span>
                  {props.collapsed ? null : (
                    <span className="min-w-0 flex-1 truncate">{space.name}</span>
                  )}
                </Link>
                {props.collapsed ? null : (
                  <div className="pointer-events-none absolute inset-y-0 right-1 z-10 flex items-center opacity-0 transition-opacity group-hover/space-row:pointer-events-auto group-hover/space-row:opacity-100 group-focus-within/space-row:pointer-events-auto group-focus-within/space-row:opacity-100">
                    <SpaceRowActions space={space} />
                  </div>
                )}
              </div>
            );
          })}
          <GlobalCreateSpaceDialog>
            {(openCreateSpaceDialog) => (
              <button
                type="button"
                className={navigatorRowClass(false, props.collapsed)}
                disabled={!canAddSpace}
                onClick={openCreateSpaceDialog}
                aria-label="New Space"
                title={canAddSpace ? "New Space" : "Space limit reached"}
              >
                <span className="grid size-7 shrink-0 place-items-center text-cream-muted">
                  <Plus size={19} strokeWidth={1.75} />
                </span>
                {props.collapsed ? null : <span>New Space</span>}
              </button>
            )}
          </GlobalCreateSpaceDialog>
        </NavigatorSection>

        <NavigatorSection
          label="Navigation"
          collapsed={props.collapsed}
          showHeader={false}
          last
          className="min-h-0 flex-1"
        >
          {toolsByGroup.map((group, index) => (
            <NavigatorToolGroup
              key={group.id}
              label={group.label}
              collapsed={props.collapsed}
              first={index === 0}
            >
              {group.items.map((item) => (
                <NavigatorLink
                  key={item.id}
                  collapsed={props.collapsed}
                  icon={item.icon}
                  label={item.label}
                  path={item.path}
                  disabled={item.disabled}
                  active={
                    !item.disabled && item.id in spaceToolGroup
                      ? activeTab?.surfaceId === "space" &&
                        activeTab.groupKey.startsWith(
                          `space:${scopedSpace?.id ?? activeSpaceId}`,
                        ) &&
                        spaceToolIsActive(item.id as SpaceToolId, activeSpaceSection)
                      : activeGroupKey === `tool:${item.id}`
                  }
                />
              ))}
            </NavigatorToolGroup>
          ))}
        </NavigatorSection>
      </div>

      <NavigatorProfileBar
        collapsed={props.collapsed}
        profileAnchorRef={props.profileAnchorRef}
        profileOpen={props.profileOpen}
        settingsOpen={props.settingsOpen}
        onProfileClick={props.onProfileClick}
        onSettingsClick={props.onSettingsClick}
      />
    </nav>
  );
}

type SpaceToolId = "journal" | "planner" | "chat" | "library";

const toolGroups: Array<{ id: ToolGroupId; label: string }> = [
  { id: "work", label: "Work" },
  { id: "explore", label: "Explore" },
  { id: "build", label: "Build" },
];

const spaceToolGroup: Record<SpaceToolId, ToolGroupId> = {
  journal: "work",
  planner: "work",
  chat: "work",
  library: "explore",
};

const globalToolGroup: Record<string, ToolGroupId> = {
  inbox: "work",
  browser: "explore",
  files: "explore",
  transfers: "explore",
  terminal: "build",
  code: "build",
  agents: "build",
};

function spaceToolItems(space: { id: string }, accountId: string) {
  const encodedSpaceId = encodeURIComponent(space.id);
  return [
    {
      id: "journal" as const,
      label: "Journal",
      icon: Notebook,
      path: rememberedJournalRoute(accountId, space.id),
    },
    {
      id: "planner" as const,
      label: "Planner",
      icon: CheckSquare2,
      path: rememberedPlannerRoute(accountId, space.id),
    },
    {
      id: "chat" as const,
      label: "Chat",
      icon: MessagesSquare,
      path: `/spaces/${encodedSpaceId}/chat`,
    },
    {
      id: "library" as const,
      label: "Library",
      icon: BookOpenText,
      path: `/spaces/${encodedSpaceId}/library`,
    },
  ];
}

function canShowSpaceTool(
  space: Parameters<typeof canOpenMistySpaceSection>[0],
  id: SpaceToolId,
): boolean {
  if (!canOpenMistySpaceSection(space, id)) return false;
  if (id === "chat" && space.permissions?.["messages.read"] === false) return false;
  if (id === "planner" && space.permissions?.["tasks.view"] === false) return false;
  if (id === "library" && (isWebBuild || space.permissions?.["library.view"] === false))
    return false;
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
    const segments = new URL(route, "https://misty.local").pathname.split("/").filter(Boolean);
    return segments[0] === "spaces" && segments[1] ? decodeURIComponent(segments[1]) : "";
  } catch {
    return "";
  }
}

function spaceToolIsActive(id: SpaceToolId, section: string): boolean {
  return id === "journal" ? section === "notes" || section === "drawings" : section === id;
}

function NavigatorToolGroup(props: {
  label: string;
  collapsed: boolean;
  first: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("grid gap-0.5", !props.first && "mt-3")}
      role="group"
      aria-label={props.label}
      data-navigator-tool-group={props.label.toLowerCase()}
    >
      {props.collapsed ? null : (
        <h3 className="px-2 pb-1 text-[13px] font-semibold tracking-[0.03em] text-cream-faint">
          {props.label}
        </h3>
      )}
      {props.children}
    </div>
  );
}

function NavigatorSection(props: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  showHeader?: boolean;
  /** The bottom-most section, which scrolls behind the floating account dock. */
  last?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden pt-3",
        props.collapsed ? "px-2" : "px-3",
        props.className,
      )}
      aria-label={props.label}
    >
      {props.collapsed || props.showHeader === false ? null : (
        <div
          className="mb-1.5 flex h-8 shrink-0 items-center gap-2 px-2"
          data-navigator-section-header={props.label.toLowerCase()}
        >
          <h2 className="min-w-0 flex-1 text-[13px] font-semibold tracking-[0.03em] text-cream-faint">
            {props.label}
          </h2>
          {props.actions}
        </div>
      )}
      <div
        className={cn(
          "grid min-h-0 flex-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto",
          "overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          props.last && (props.collapsed ? "pb-[104px]" : "pb-[60px]"),
        )}
        data-navigator-section-scroll={props.label.toLowerCase()}
      >
        {props.children}
      </div>
    </section>
  );
}

function NavigatorLink(props: {
  collapsed: boolean;
  icon: LucideIcon;
  label: string;
  path: string;
  active: boolean;
  disabled?: boolean;
}) {
  const Icon = props.icon;
  const content = (
    <>
      <Icon size={19} className="shrink-0" strokeWidth={1.75} />
      {props.collapsed ? null : <span className="min-w-0 flex-1 truncate">{props.label}</span>}
    </>
  );
  if (props.disabled) {
    return (
      <div
        className={cn(
          navigatorRowClass(false, props.collapsed),
          "cursor-default opacity-60 hover:bg-transparent hover:text-cream-muted",
        )}
        aria-disabled="true"
        aria-label={props.label}
        title="Waiting for Spaces"
      >
        {content}
      </div>
    );
  }
  return (
    <NavLink
      to={props.path}
      onClick={() => {
        const surface = workspaceSurfaceFromRoute(props.path);
        if (surface) {
          useWorkspaceStore.getState().openSurface(surface);
        }
      }}
      className={navigatorRowClass(props.active, props.collapsed)}
      aria-current={props.active ? "page" : undefined}
      aria-label={props.label}
      title={props.label}
    >
      {content}
    </NavLink>
  );
}

function navigatorShortcutClass(active: boolean): string {
  return cn(
    "grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent",
    "text-cream-muted no-underline outline-none transition-colors",
    "hover:bg-charcoal-card hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-charcoal-active",
    active && "bg-charcoal-card text-cream-bright",
  );
}

function navigatorRowClass(active: boolean, collapsed: boolean): string {
  return cn(
    "relative flex items-center rounded-md border-0 bg-transparent text-sm text-cream-muted no-underline outline-none transition-colors",
    // Compact rows are square tiles centred in the rail rather than full-width
    // bars, so the selection background reads as an icon button.
    collapsed ? "mx-auto size-9 justify-center px-0" : "h-9 w-full justify-start gap-2.5 px-2.5",
    "hover:bg-charcoal-card hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-charcoal-active",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-cream-muted",
    active && "bg-charcoal-card text-cream-bright",
    active && "before:absolute before:h-6 before:w-0.5 before:rounded-r before:bg-sage-fg",
    active && (collapsed ? "before:-left-2" : "before:-left-3"),
  );
}
