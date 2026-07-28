import type { ReactNode } from "react";
import {
  BookOpenText,
  CheckSquare2,
  MessagesSquare,
  BookHeart,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/ui";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { spaceNotesEnabled } from "@/features/notes/availability";

// Work surfaces only. Members and Settings are Space management and live in the
// Space header dropdown so they do not read as daily navigation.
const sections = [
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "tasks", label: "Tasks", icon: CheckSquare2 },
  { id: "journal", label: "Journal", icon: BookHeart },
  { id: "library", label: "Library", icon: BookOpenText },
] as const;

export function SpaceSectionNavigation({
  spaceId,
  section,
  context,
}: {
  spaceId: string;
  section: string;
  context?: ReactNode;
}) {
  const permissions = useSpacesStore(
    (state) => state.spaces.find((item) => item.id === spaceId)?.permissions,
  );
  const visibleSections = sections
    .filter(({ id }) => id !== "chat" || permissions?.["messages.read"] !== false)
    .filter(({ id }) => id !== "tasks" || permissions?.["tasks.view"] !== false)
    .filter(({ id }) => id !== "library" || permissions?.["library.view"] !== false);
  const journalDestination =
    spaceNotesEnabled && permissions?.["library.view"] !== false ? "notes" : "drawings";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        className="grid shrink-0 gap-1.5 rounded-xl bg-sidebar-accent/30 p-1.5 ring-1 ring-sidebar-border/60"
        style={{ gridTemplateColumns: `repeat(${visibleSections.length}, minmax(0, 1fr))` }}
        aria-label="Space sections"
      >
        {visibleSections.map(({ id, label, icon: Icon }) => (
          <SpaceNavigationLink
            key={id}
            active={
              id === "journal" ? section === "notes" || section === "drawings" : section === id
            }
            icon={Icon}
            label={label}
            to={`/spaces/${encodeURIComponent(spaceId)}/${id === "journal" ? journalDestination : id}`}
          />
        ))}
      </nav>

      <div
        className={cn(
          "misty-transient-scrollbar min-h-0 flex-1 overflow-x-hidden pt-4 [overscroll-behavior:contain]",
          "overflow-y-auto",
        )}
      >
        {context}
      </div>
    </div>
  );
}

function SpaceNavigationLink({
  active,
  icon: Icon,
  label,
  to,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  to: string;
}) {
  return (
    <Link
      className={navigationItemClass(active)}
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <NavigationIcon active={active} icon={Icon} />
      <span className="sr-only">{label}</span>
    </Link>
  );
}

function NavigationIcon({ active, icon: Icon }: { active: boolean; icon: LucideIcon }) {
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center",
        active
          ? "text-sidebar-accent-foreground"
          : "text-muted-foreground group-hover:text-sidebar-accent-foreground",
      )}
      aria-hidden="true"
    >
      <Icon size={18} strokeWidth={1.8} />
    </span>
  );
}

function navigationItemClass(active: boolean) {
  return cn(
    "group relative grid h-10 min-w-0 place-items-center rounded-lg no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs ring-1 ring-sidebar-border/70"
      : "text-muted-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}
