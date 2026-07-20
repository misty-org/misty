import type { ReactNode } from "react";
import { BookOpenText, Bot, CheckSquare2, MessagesSquare, Settings2, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSpacesStore } from "../../../stores/useSpacesStore";

const sections = [
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "tasks", label: "Tasks", icon: CheckSquare2 },
  { id: "library", label: "Library", icon: BookOpenText },
  { id: "members", label: "Members", icon: Users },
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
    .filter(
      ({ id }) =>
        id !== "agents" ||
        permissions?.["agents.run"] !== false ||
        permissions?.["studio.view"] !== false,
    )
    .filter(({ id }) => id !== "tasks" || permissions?.["tasks.view"] !== false)
    .filter(({ id }) => id !== "library" || permissions?.["library.view"] !== false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        className="grid shrink-0 grid-cols-6 gap-1.5 rounded-xl bg-sidebar-accent/30 p-1.5 ring-1 ring-sidebar-border/60"
        aria-label="Space sections"
      >
        {visibleSections.map(({ id, label, icon: Icon }) => (
          <SpaceNavigationLink
            key={id}
            active={section === id || (id === "agents" && section === "studio")}
            icon={Icon}
            label={label}
            to={`/spaces/${encodeURIComponent(spaceId)}/${id}`}
          />
        ))}
        <SpaceNavigationLink
          active={section === "settings"}
          icon={Settings2}
          label="Settings"
          to={`/spaces/${encodeURIComponent(spaceId)}/settings/general`}
        />
      </nav>

      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-4 [overscroll-behavior:contain]">
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
  icon: typeof Settings2;
  label: string;
  to: string;
}) {
  return (
    <Link
      className={cn(
        "group relative grid h-10 min-w-0 place-items-center rounded-lg no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs ring-1 ring-sidebar-border/70"
          : "text-muted-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
      )}
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
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
      <span className="sr-only">{label}</span>
    </Link>
  );
}
