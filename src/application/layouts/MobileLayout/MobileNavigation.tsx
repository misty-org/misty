import { spaceNavigationName, type Space } from "@/features/spaces";
import { cn } from "@/shared/ui";
import {
  Bot,
  BookOpenText,
  ChevronRight,
  FolderOpen,
  Globe2,
  House,
  Inbox,
  Library,
  ListTodo,
  MessageCircle,
  Settings,
  Store,
  LayoutGrid,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Destination = { id: string; label: string; path: string; icon: LucideIcon };

export function MobileNavigation(props: {
  activePath: string;
  activeSpaceId: string;
  spaces: Space[];
  core: Destination[];
  more: Destination[];
  account: { name: string; email: string } | null;
  onAccount: () => void;
  onNavigate: (path: string) => void;
  onSelectSpace: (spaceId: string) => void;
}) {
  return (
    <>
      <nav
        className="grid min-h-[56px] grid-cols-3 border-t border-charcoal-border bg-charcoal-workspace pb-[env(safe-area-inset-bottom)] min-[1024px]:hidden"
        aria-label="Mobile primary"
      >
        {props.core.map((item) => (
          <MobileNavButton
            key={item.id}
            item={item}
            active={routeIsActive(props.activePath, item.path, item.id)}
            onClick={() => props.onNavigate(item.path)}
          />
        ))}
      </nav>

      <aside className="hidden min-h-0 w-[280px] flex-col border-r border-charcoal-border bg-charcoal-workspace min-[1024px]:flex">
        <NavigationContent {...props} />
      </aside>
    </>
  );
}

function NavigationContent(props: Parameters<typeof MobileNavigation>[0]) {
  return (
    <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      <button
        type="button"
        className="mb-3 flex min-h-16 w-full items-center gap-3 rounded-xl border border-charcoal-border bg-charcoal-card px-3 text-left active:bg-charcoal-active"
        onClick={props.onAccount}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-charcoal-active text-sm font-semibold text-cream-bright">
          {props.account ? (
            profileInitials(props.account.name, props.account.email)
          ) : (
            <UserRound size={21} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-cream-bright">
            {props.account?.name || "Sign in to Misty"}
          </span>
          <span className="mt-0.5 block truncate text-xs text-cream-muted">
            {props.account?.email || "Sync your Spaces and conversations"}
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-cream-muted" aria-hidden="true" />
      </button>
      <p className="px-2 pb-1 pt-1 text-xs font-semibold text-cream-muted">Spaces</p>
      <div className="grid gap-0.5">
        {props.spaces.map((space) => (
          <button
            key={space.id}
            type="button"
            aria-current={space.id === props.activeSpaceId ? "true" : undefined}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px]",
              space.id === props.activeSpaceId
                ? "bg-charcoal-active text-cream-bright"
                : "text-cream-muted active:bg-charcoal-card",
            )}
            onClick={() => props.onSelectSpace(space.id)}
          >
            <span className="grid size-7 place-items-center rounded-md bg-charcoal-card font-semibold text-cream-bright">
              {(space.name || "S").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{spaceNavigationName(space)}</span>
          </button>
        ))}
      </div>
      <p className="px-2 pb-1 pt-5 text-xs font-semibold text-cream-muted">Tools</p>
      <div className="grid grid-cols-2 gap-1.5 min-[1024px]:grid-cols-1">
        {[...props.core, ...props.more].map((item) => {
          const Icon = item.icon;
          const active = routeIsActive(props.activePath, item.path, item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              className={cn(
                "grid min-h-12 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-lg px-3 text-left text-[15px]",
                active
                  ? "bg-charcoal-active text-cream-bright"
                  : "text-cream-muted active:bg-charcoal-card",
              )}
              onClick={() => props.onNavigate(item.path)}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function profileInitials(name: string, email: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || email[0]?.toUpperCase() || "M";
}

function MobileNavButton(props: { item: Destination; active: boolean; onClick: () => void }) {
  const Icon = props.item.icon;
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "grid min-h-14 min-w-0 grid-rows-[28px_16px] place-items-center pt-1 text-[10px] font-medium",
        props.active ? "text-cream-bright" : "text-cream-muted active:text-cream-bright",
      )}
      onClick={props.onClick}
    >
      <Icon size={21} strokeWidth={props.active ? 2.1 : 1.8} aria-hidden="true" />
      <span className="max-w-full truncate px-1">{props.item.label}</span>
    </button>
  );
}

export const mobileNavigationIcons = {
  home: House,
  apps: LayoutGrid,
  store: Store,
  chat: MessageCircle,
  planner: ListTodo,
  inbox: Inbox,
  journal: BookOpenText,
  library: Library,
  agents: Bot,
  browser: Globe2,
  files: FolderOpen,
  settings: Settings,
};

function routeIsActive(current: string, target: string, id: string): boolean {
  if (id === "home") return /\/spaces\/[^/]+\/home(?:\/|$)/.test(current);
  if (id === "chat") return /\/spaces\/[^/]+\/(?:social|chat)(?:\/|$)/.test(current);
  if (id === "planner") return /\/spaces\/[^/]+\/planner(?:\/|$)/.test(current);
  return Boolean(target && (current === target || current.startsWith(`${target}/`)));
}
