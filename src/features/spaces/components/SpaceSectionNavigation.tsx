import type { ReactNode } from "react";
import {
  BookOpenText,
  CheckSquare2,
  MessagesSquare,
  Notebook,
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
  { id: "planner", label: "Planner", icon: CheckSquare2 },
  { id: "journal", label: "Journal", icon: Notebook },
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
    .filter(({ id }) => id !== "planner" || permissions?.["tasks.view"] !== false)
    .filter(({ id }) => id !== "library" || permissions?.["library.view"] !== false);
  const journalDestination =
    spaceNotesEnabled && permissions?.["library.view"] !== false ? "notes" : "drawings";

  const navigation = (
    <nav className="flex min-w-0 items-center gap-1" aria-label="Space sections">
      {visibleSections.map(({ id, label, icon: Icon }) => (
        <SpaceNavigationLink
          key={id}
          active={id === "journal" ? section === "notes" || section === "drawings" : section === id}
          icon={Icon}
          label={label}
          to={`/spaces/${encodeURIComponent(spaceId)}/${id === "journal" ? journalDestination : id}`}
        />
      ))}
    </nav>
  );

  if (!context) return navigation;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {navigation}
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
      aria-current={active ? "page" : undefined}
    >
      <NavigationIcon active={active} icon={Icon} />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

function NavigationIcon({ active, icon: Icon }: { active: boolean; icon: LucideIcon }) {
  return (
    <span
      className={cn(
        "grid size-5 shrink-0 place-items-center",
        active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
      )}
      aria-hidden="true"
    >
      <Icon size={15} strokeWidth={1.75} />
    </span>
  );
}

function navigationItemClass(active: boolean) {
  return cn(
    "misty-hover-marker-bottom group relative flex h-8 min-w-0 items-center justify-center",
    "gap-1.5 rounded-md px-3 text-[12.5px] font-medium no-underline outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "misty-active-marker-bottom text-foreground"
      : "text-muted-foreground hover:text-foreground",
  );
}
