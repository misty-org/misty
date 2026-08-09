import { unreadActivityCountForSpaceSection, useActivityStore } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { BookOpenText, CheckSquare2, MessagesSquare, Notebook } from "lucide-react";
import { rememberedJournalRoute, rememberedPlannerRoute } from "../spacesShell/spaceSubpageMemory";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpaceSidebarLink } from "./spacePanel/SpaceSidebarLink";

// Work surfaces only. Management controls live at the opposite end of the top bar.
const sections = [
  { id: "journal", label: "Journal", icon: Notebook },
  { id: "planner", label: "Planner", icon: CheckSquare2 },
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "library", label: "Library", icon: BookOpenText },
] as const;

export function SpaceSectionNavigation({ spaceId, section }: { spaceId: string; section: string }) {
  const { user } = useAuth();
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const permissions = space?.permissions;
  const visibleSections = sections
    .filter(({ id }) => space?.kind !== "misty" || id === "chat")
    .filter(({ id }) => id !== "chat" || permissions?.["messages.read"] !== false)
    .filter(({ id }) => id !== "planner" || permissions?.["tasks.view"] !== false)
    .filter(({ id }) => id !== "library" || permissions?.["library.view"] !== false);
  const accountId = user?.id ?? "";
  const activityItems = useActivityStore((state) => state.allItems);

  return (
    <nav className="grid min-w-0 gap-1" aria-label="Space sections">
      {visibleSections.map(({ id, label, icon: Icon }) => (
        <SpaceSidebarLink
          key={id}
          active={id === "journal" ? section === "notes" || section === "drawings" : section === id}
          icon={Icon}
          label={label}
          badgeCount={unreadActivityCountForSpaceSection(activityItems, spaceId, id)}
          to={
            id === "journal"
              ? rememberedJournalRoute(accountId, spaceId)
              : id === "planner"
                ? rememberedPlannerRoute(accountId, spaceId)
                : `/spaces/${encodeURIComponent(spaceId)}/${id}`
          }
        />
      ))}
    </nav>
  );
}
