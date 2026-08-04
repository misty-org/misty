import { spaceNotesEnabled } from "@/features/notes/availability";
import { NotesPanelSidebar } from "@/features/notes/components/NotesPanelSidebar";
import { DrawingPanelSidebar } from "@/features/drawings/components/DrawingPanelSidebar";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import { SpaceChatConversationList } from "../SpaceChatConversationList";
import { SpaceSidebarSection } from "../SpaceSidebarSection";
import { rememberedJournalRoute } from "../../spacesShell/spaceSubpageMemory";
import { PlannerPanelSidebar } from "./PlannerPanelSidebar";
import { librarySidebarItems } from "./librarySidebarItems";
import { SpaceSidebarLink } from "./SpaceSidebarLink";

export interface SpacePanelSidebarContextProps {
  section: string;
  plannerSection: "tasks" | "agenda" | "roadmaps";
  roadmapId: string;
  activeSpaceId: string;
  activeSpaceName: string;
  settingsSection: string;
  libraryCollection: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId: string | undefined;
  activeDrawingId: string;
  supportOnly?: boolean;
  onCreateConversation?: () => void;
  onEditConversation?: (conversation: SpaceConversation) => void;
}

/**
 * The contextual half of the Space panel, below the Space switcher.
 *
 * Journal and Planner expose their pages as independent dropdowns here; other
 * work surfaces keep a single contextual branch.
 */
export function SpacePanelSidebarContext(props: SpacePanelSidebarContextProps) {
  const spacePath = `/spaces/${encodeURIComponent(props.activeSpaceId)}`;
  if (props.section === "chat") {
    return (
      <div className="grid gap-3">
        <SpaceChatConversationList
          activeSpaceId={props.activeSpaceId}
          conversations={props.conversations}
          activeConversationId={props.activeConversationId}
          currentUserId={props.currentUserId}
          supportOnly={props.supportOnly}
          onCreateConversation={props.onCreateConversation}
          onEditConversation={props.onEditConversation}
        />
      </div>
    );
  }

  if (props.section === "planner") {
    return (
      <PlannerPanelSidebar
        spaceId={props.activeSpaceId}
        section={props.plannerSection}
        roadmapId={props.roadmapId}
      />
    );
  }

  if ((props.section === "notes" && spaceNotesEnabled) || props.section === "drawings") {
    const accountId = props.currentUserId ?? "";
    return (
      <div className="grid gap-2">
        {spaceNotesEnabled ? (
          <NotesPanelSidebar
            spaceId={props.activeSpaceId}
            spaceName={props.activeSpaceName}
            section={{
              active: props.section === "notes",
              to: rememberedJournalRoute(accountId, props.activeSpaceId, "notes"),
            }}
          />
        ) : null}
        <DrawingPanelSidebar
          spaceId={props.activeSpaceId}
          activeDrawingId={props.activeDrawingId}
          section={{
            active: props.section === "drawings",
            to: rememberedJournalRoute(accountId, props.activeSpaceId, "drawings"),
          }}
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
