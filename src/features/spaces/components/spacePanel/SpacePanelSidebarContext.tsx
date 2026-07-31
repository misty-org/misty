import { CalendarClock, ListTodo, UserRound, UserRoundX } from "lucide-react";
import { useLocation } from "react-router-dom";
import { spaceNotesEnabled } from "@/features/notes/availability";
import { NotesPanelSidebar } from "@/features/notes/components/NotesPanelSidebar";
import { DrawingPanelSidebar } from "@/features/drawings/components/DrawingPanelSidebar";
import { JournalSectionSwitcher } from "@/features/journal/components/JournalSectionSwitcher";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import { SpaceChatConversationList } from "../SpaceChatConversationList";
import { SpaceSidebarSection } from "../SpaceSidebarSection";
import { SpaceSidebarLink } from "./SpaceSidebarLink";
import { librarySidebarItems } from "./librarySidebarItems";

export interface SpacePanelSidebarContextProps {
  section: string;
  taskView: string;
  activeSpaceId: string;
  activeSpaceName: string;
  settingsSection: string;
  libraryCollection: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId: string | undefined;
  activeDrawingId: string;
  onCreateConversation: () => void;
  onEditConversation: (conversation: SpaceConversation) => void;
}

/**
 * The section-specific half of the Space panel, below the section navigation.
 *
 * Each section owns one branch here so adding a section never means reading
 * through the panel's data loading or the Space switcher.
 */
export function SpacePanelSidebarContext(props: SpacePanelSidebarContextProps) {
  const spacePath = `/spaces/${encodeURIComponent(props.activeSpaceId)}`;
  const location = useLocation();
  const search = new URLSearchParams(location.search);

  if (props.section === "chat") {
    return (
      <div className="grid gap-3">
        <SpaceChatConversationList
          activeSpaceId={props.activeSpaceId}
          conversations={props.conversations}
          activeConversationId={props.activeConversationId}
          currentUserId={props.currentUserId}
          onCreateConversation={props.onCreateConversation}
          onEditConversation={props.onEditConversation}
        />
      </div>
    );
  }

  if (props.section === "planner") {
    const taskPath = `${spacePath}/planner/${props.taskView}`;
    const hasTaskFilter = ["mine", "assignee", "due", "status", "priority"].some((key) =>
      search.has(key),
    );

    return (
      <SpaceSidebarSection title="Planner">
        <nav className="grid gap-1" aria-label="Task shortcuts">
          {[
            {
              id: "all",
              label: "All tasks",
              icon: ListTodo,
              active: !hasTaskFilter,
              to: taskPath,
            },
            {
              id: "mine",
              label: "Assigned to me",
              icon: UserRound,
              active: search.get("mine") === "1",
              to: `${taskPath}?mine=1`,
            },
            {
              id: "unassigned",
              label: "Unassigned",
              icon: UserRoundX,
              active: search.get("assignee") === "unassigned",
              to: `${taskPath}?assignee=unassigned`,
            },
            {
              id: "week",
              label: "Due this week",
              icon: CalendarClock,
              active: search.get("due") === "week",
              to: `${taskPath}?due=week`,
            },
          ].map(({ id, label, icon, active, to }) => (
            <SpaceSidebarLink key={id} active={active} icon={icon} label={label} to={to} />
          ))}
        </nav>
      </SpaceSidebarSection>
    );
  }

  if (props.section === "notes" && spaceNotesEnabled) {
    return (
      <div className="grid gap-4">
        <JournalSectionSwitcher spaceId={props.activeSpaceId} section={props.section} />
        <NotesPanelSidebar spaceId={props.activeSpaceId} spaceName={props.activeSpaceName} />
      </div>
    );
  }

  if (props.section === "drawings") {
    return (
      <div className="grid gap-4">
        <JournalSectionSwitcher spaceId={props.activeSpaceId} section={props.section} />
        <DrawingPanelSidebar
          spaceId={props.activeSpaceId}
          activeDrawingId={props.activeDrawingId}
        />
      </div>
    );
  }

  if (props.section === "library") {
    return (
      <div className="grid gap-3">
        <SpaceSidebarSection title="Browse">
          <nav className="grid gap-1" aria-label="Library collections">
            {librarySidebarItems.map(({ collection, label, icon }) => (
              <SpaceSidebarLink
                key={collection}
                active={props.libraryCollection === collection}
                icon={icon}
                label={label}
                to={`${spacePath}/library?collection=${collection}`}
              />
            ))}
          </nav>
        </SpaceSidebarSection>
      </div>
    );
  }

  return null;
}
