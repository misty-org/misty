import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import { routes } from "@/features/app-shell";
import { useGlobalSearchStore } from "@/features/global-search";
import {
  CreateSpaceDialog,
  SpaceAvatar,
  spaceDestination,
  useCreateSpaceDialog,
  useSpacesStore,
} from "@/features/spaces";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { cn } from "@/shared/ui";
import {
  Activity,
  Blocks,
  Bot,
  Code2,
  FolderOpen,
  Globe2,
  House,
  Plus,
  Search,
  Settings,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode, type RefObject } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { DeploymentMenu } from "./DeploymentMenu";
import { ProfileNavButton } from "./NavRail";

const toolItems: Array<{ id: string; label: string; path: string; icon: LucideIcon }> = [
  { id: "browser", label: "Browser", path: routes.browser, icon: Globe2 },
  { id: "terminal", label: "Terminal", path: routes.terminal, icon: TerminalSquare },
  { id: "code", label: "Code", path: routes.code, icon: Code2 },
  { id: "files", label: "Files", path: routes.files, icon: FolderOpen },
  { id: "agents", label: "Agents", path: routes.agents, icon: Bot },
  { id: "extensions", label: "Extensions", path: routes.extensions, icon: Blocks },
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
}) {
  const location = useLocation();
  // The rail marks what the workspace is actually showing, not the last thing
  // that was clicked, so it follows the focused pane's active tab.
  const activeGroupKey = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((candidate) => candidate.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId)?.groupKey ?? null;
  });
  const spaces = useSpacesStore((state) => state.spaces);
  const invitations = useSpacesStore((state) => state.invitations);
  const limits = useSpacesStore((state) => state.limits);
  const createSpace = useSpacesStore((state) => state.createSpace);
  const clearSpaceError = useSpacesStore((state) => state.clearError);
  const spaceError = useSpacesStore((state) => state.error);
  const createSpaceDialog = useCreateSpaceDialog({ createSpace, clearError: clearSpaceError });
  const activityItems = useActivityStore((state) => state.allItems);
  const visibleSpaces = useMemo(
    () => spaces.filter((space) => !invitations.some((invite) => invite.space_id === space.id)),
    [invitations, spaces],
  );
  const canAddSpace = !limits || limits.unlimited_spaces || spaces.length < limits.space_limit;

  return (
    <nav
      className={cn(
        "relative z-20 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-charcoal-border bg-charcoal-workspace",
        props.collapsed ? "items-center" : "items-stretch",
      )}
      aria-label="Primary"
      onPointerDown={props.onStartWindowDrag}
    >
      <div
        className={cn(
          "flex h-[58px] shrink-0 select-none items-center border-b border-charcoal-border/70",
          props.collapsed ? "justify-center px-2" : "gap-2.5 px-3",
        )}
      >
        <DeploymentMenu
          collapsed={props.collapsed}
          mistyLogoSource={props.mistyLogoSource}
          onConnectServer={props.onSettingsClick}
        />
      </div>

      <div
        className={cn("grid shrink-0 gap-0.5", props.collapsed ? "px-2 pt-3" : "px-3 pt-3")}
        data-misty-window-drag-block="true"
      >
        <NavigatorLink
          collapsed={props.collapsed}
          icon={House}
          label="Home"
          path={routes.home}
          active={
            activeGroupKey ? activeGroupKey === "tool:home" : location.pathname === routes.home
          }
        />
        <button
          type="button"
          className={navigatorRowClass(false, props.collapsed)}
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
          <Search size={19} className="shrink-0" strokeWidth={1.75} />
          {props.collapsed ? null : (
            <span className="min-w-0 flex-1 truncate text-left">Search</span>
          )}
        </button>
      </div>

      <div
        className="misty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        data-misty-window-drag-block="true"
      >
        <NavigatorSection label="Spaces" collapsed={props.collapsed}>
          {visibleSpaces.map((space) => {
            const active = activeGroupKey === `space:${space.id}`;
            const unread = unreadActivityCountForSpace(activityItems, space.id);
            return (
              <NavLink
                key={space.id}
                to={spaceDestination(location.pathname, space.id)}
                className={navigatorRowClass(active, props.collapsed)}
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
                {!props.collapsed && active ? (
                  <span className="size-1.5 rounded-full bg-sage-fg" />
                ) : null}
              </NavLink>
            );
          })}
          <button
            type="button"
            className={navigatorRowClass(false, props.collapsed)}
            disabled={!canAddSpace}
            onClick={createSpaceDialog.start}
            aria-label="New Space"
            title={canAddSpace ? "New Space" : "Space limit reached"}
          >
            <span className="grid size-7 shrink-0 place-items-center text-cream-muted">
              <Plus size={19} strokeWidth={1.75} />
            </span>
            {props.collapsed ? null : <span>New Space</span>}
          </button>
        </NavigatorSection>

        <NavigatorSection label="Tools" collapsed={props.collapsed}>
          {toolItems.map((item) => (
            <NavigatorLink
              key={item.id}
              collapsed={props.collapsed}
              icon={item.icon}
              label={item.label}
              path={item.path}
              active={activeGroupKey === `tool:${item.id}`}
            />
          ))}
        </NavigatorSection>
      </div>

      <div
        className={cn(
          "shrink-0 border-t border-charcoal-border/70 py-2",
          props.collapsed ? "px-2" : "px-3",
        )}
      >
        <NavigatorLink
          collapsed={props.collapsed}
          icon={Activity}
          label="Activity"
          path={routes.activity}
          active={location.pathname.startsWith(routes.activity)}
        />
        <button
          type="button"
          className={navigatorRowClass(props.settingsOpen, props.collapsed)}
          onClick={props.onSettingsClick}
          aria-label="Settings"
          data-misty-window-drag-block="true"
        >
          <Settings size={19} className="shrink-0" strokeWidth={1.75} />
          {props.collapsed ? null : <span>Settings</span>}
        </button>
        <ProfileNavButton
          ref={props.profileAnchorRef}
          open={props.profileOpen}
          onClick={props.onProfileClick}
          className={navigatorRowClass(props.profileOpen, props.collapsed)}
          avatarClassName="size-6 border-0 bg-transparent ring-0 group-hover/profile:ring-0"
          label={props.collapsed ? null : "Profile"}
        />
      </div>
      <CreateSpaceDialog dialog={createSpaceDialog} error={spaceError ?? ""} />
    </nav>
  );
}

function NavigatorSection(props: { label: string; collapsed: boolean; children: ReactNode }) {
  return (
    <section className={cn("pt-3", props.collapsed ? "px-2" : "px-3")} aria-label={props.label}>
      {props.collapsed ? (
        <div className="mx-auto mb-2 h-px w-7 bg-charcoal-border" aria-hidden="true" />
      ) : (
        <h2 className="mb-1.5 px-2 text-[11px] font-semibold tracking-[0.03em] text-cream-faint">
          {props.label}
        </h2>
      )}
      <div className="grid gap-0.5">{props.children}</div>
    </section>
  );
}

function NavigatorLink(props: {
  collapsed: boolean;
  icon: LucideIcon;
  label: string;
  path: string;
  active: boolean;
}) {
  const Icon = props.icon;
  return (
    <NavLink
      to={props.path}
      className={navigatorRowClass(props.active, props.collapsed)}
      aria-current={props.active ? "page" : undefined}
      aria-label={props.label}
      title={props.label}
    >
      <Icon size={19} className="shrink-0" strokeWidth={1.75} />
      {props.collapsed ? null : <span className="min-w-0 flex-1 truncate">{props.label}</span>}
    </NavLink>
  );
}

function navigatorRowClass(active: boolean, collapsed: boolean): string {
  return cn(
    "relative flex items-center rounded-md border-0 bg-transparent text-sm text-cream-muted no-underline outline-none transition-colors",
    // Compact rows are square tiles centred in the rail rather than full-width
    // bars, so the selection background reads as an icon button.
    collapsed ? "mx-auto size-10 justify-center px-0" : "h-10 w-full justify-start gap-2.5 px-2.5",
    "hover:bg-charcoal-card hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-charcoal-active",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-cream-muted",
    active && "bg-charcoal-card text-cream-bright",
    active && "before:absolute before:h-6 before:w-0.5 before:rounded-r before:bg-sage-fg",
    active && (collapsed ? "before:-left-2" : "before:-left-3"),
  );
}
