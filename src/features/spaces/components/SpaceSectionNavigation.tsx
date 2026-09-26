import { TooltipProvider } from "@/shared/ui";
import { appIcons } from "@/shared/ui/app-icons";
import { unreadActivityCountForSpaceSection, useActivityStore } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { BookOpenText, MessagesSquare, Notebook } from "lucide-react";
import { rememberedJournalRoute, rememberedPlannerRoute } from "../spacesShell/spaceSubpageMemory";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpaceSidebarLink } from "./spacePanel/SpaceSidebarLink";

// Work surfaces only. Management controls live at the bottom of the Space rail.
const sections = [
  { id: "social", label: "Chat", icon: MessagesSquare },
  { id: "planner", label: "Planner", icon: appIcons.planner },
  { id: "journal", label: "Journal", icon: Notebook },
  { id: "library", label: "Library", icon: BookOpenText },
] as const;

export function SpaceSectionNavigation({
  spaceId,
  section,
  horizontal,
  iconOnly = false,
  onNavigate,
}: {
  spaceId: string;
  section: string;
  horizontal?: boolean;
  iconOnly?: boolean;
  onNavigate?: (path: string) => void;
}) {
  const { user } = useAuth();
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const permissions = space?.permissions;
  const visibleSections = sections
    .filter(({ id }) => id !== "social" || permissions?.["messages.read"] !== false)
    .filter(({ id }) => id !== "planner" || permissions?.["tasks.view"] !== false)
    .filter(({ id }) => id !== "library" || permissions?.["library.view"] !== false);
  const accountId = user?.id ?? "";
  const activityItems = useActivityStore((state) => state.allItems);

  return (
    <TooltipProvider delayDuration={350}>
      <nav
        className={
          horizontal ? "flex min-w-0 items-center gap-1 overflow-x-auto" : "grid min-w-0 gap-1"
        }
        aria-label="Space sections"
      >
        {visibleSections.map(({ id, label, icon: Icon }) => (
          <SpaceSidebarLink
            key={id}
            horizontal={horizontal}
            iconOnly={iconOnly}
            active={
              id === "journal" ? section === "notes" || section === "drawings" : section === id
            }
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
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </TooltipProvider>
  );
}
