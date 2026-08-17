import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import { routes } from "@/features/app-shell";
import { useGlobalSearchStore } from "@/features/global-search";
import { SpaceAvatar, spaceDestination, useSpacesStore } from "@/features/spaces";
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
  const spaces = useSpacesStore((state) => state.spaces);
  const invitations = useSpacesStore((state) => state.invitations);
  const limits = useSpacesStore((state) => state.limits);
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
          "flex h-[58px] shrink-0 items-center border-b border-charcoal-border/70",
          props.collapsed ? "justify-center px-2" : "gap-2.5 px-4",
        )}
      >
        {props.mistyLogoSource ? (
          <img className="size-8 object-contain" src={props.mistyLogoSource} alt="Misty" />
        ) : null}
        {props.collapsed ? null : (
          <span className="min-w-0 flex-1 truncate text-[19px] font-semibold tracking-[-0.02em] text-cream-bright">
            Misty
          </span>
        )}
      </div>

      <div className={cn("shrink-0", props.collapsed ? "px-2 pt-3" : "px-3 pt-3")}>
        <button
          type="button"
          className={cn(
            "flex h-10 w-full items-center rounded-lg border border-charcoal-border",
            "bg-charcoal-bg/65 text-cream-muted transition-colors",
            "hover:border-charcoal-active hover:text-cream-bright",
            props.collapsed ? "justify-center px-0" : "gap-2.5 px-3",
          )}
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
          aria-label="Open Misty search"
          title="Open Misty search (⌘K)"
          data-misty-window-drag-block="true"
        >
          <Search size={17} strokeWidth={1.8} />
          {props.collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 text-left text-sm">Open…</span>
              <kbd className="rounded bg-charcoal-card px-1.5 py-0.5 text-[11px] text-cream-faint">
                ⌘K
              </kbd>
            </>
          )}
        </button>
      </div>

      <div className={cn("shrink-0", props.collapsed ? "px-2 pt-2" : "px-3 pt-2")}>
        <NavigatorLink
          collapsed={props.collapsed}
          icon={House}
          label="Home"
          path={routes.home}
          active={location.pathname === routes.home}
        />
      </div>

      <div
        className="misty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        data-misty-window-drag-block="true"
      >
        <NavigatorSection label="Spaces" collapsed={props.collapsed}>
          {visibleSpaces.map((space) => {
            const active = location.pathname.startsWith(`/spaces/${encodeURIComponent(space.id)}`);
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
                  <SpaceAvatar space={space} className="size-7 rounded-md" />
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
          <NavLink
            to="/spaces?createSpace=1"
            className={navigatorRowClass(false, props.collapsed)}
            aria-disabled={!canAddSpace || undefined}
            onClick={(event) => {
              if (!canAddSpace) event.preventDefault();
            }}
            title={canAddSpace ? "New Space" : "Space limit reached"}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-charcoal-border text-cream-muted">
              <Plus size={16} />
            </span>
            {props.collapsed ? null : <span>New Space</span>}
          </NavLink>
        </NavigatorSection>

        <NavigatorSection label="Tools" collapsed={props.collapsed}>
          {toolItems.map((item) => (
            <NavigatorLink
              key={item.id}
              collapsed={props.collapsed}
              icon={item.icon}
              label={item.label}
              path={item.path}
              active={
                location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
              }
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
        <div
          className={cn(
            "flex h-11 items-center",
            props.collapsed ? "justify-center" : "gap-2 px-1",
          )}
        >
          <ProfileNavButton
            ref={props.profileAnchorRef}
            open={props.profileOpen}
            onClick={props.onProfileClick}
          />
          {props.collapsed ? null : (
            <button
              type="button"
              className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm text-cream-muted hover:text-cream-bright"
              onClick={props.onProfileClick}
            >
              Profile
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

function NavigatorSection(props: { label: string; collapsed: boolean; children: ReactNode }) {
  return (
    <section className={cn("pt-3", props.collapsed ? "px-2" : "px-3")} aria-label={props.label}>
      {props.collapsed ? (
        <div className="mx-auto mb-2 h-px w-7 bg-charcoal-border" aria-hidden="true" />
      ) : (
        <h2 className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-cream-faint">
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
    "relative flex h-10 w-full items-center rounded-md border-0 bg-transparent text-sm text-cream-muted no-underline outline-none transition-colors",
    collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
    "hover:bg-charcoal-card hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-charcoal-active",
    active &&
      "bg-charcoal-card text-cream-bright before:absolute before:-left-3 before:h-6 before:w-0.5 before:rounded-r before:bg-sage-fg",
  );
}
