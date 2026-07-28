import { MessageSquare, Plug, Settings2 } from "lucide-react";
import { spaceNotesEnabled } from "@/features/notes/availability";
import { NotesPanelSidebar } from "@/features/notes/components/NotesPanelSidebar";
import { DrawingPanelSidebar } from "@/features/drawings/components/DrawingPanelSidebar";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import { SpaceChatConversationList } from "../SpaceChatConversationList";
import { SpaceSidebarSection } from "../SpaceSidebarSection";
import { SpaceSidebarLink } from "./SpaceSidebarLink";
import { librarySidebarItems } from "./librarySidebarItems";
import type { ConversationDialogKind } from "../CreateEditConversationDialog";

const settingsSidebarItems = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "integrations", label: "Integrations", icon: Plug },
] as const;

export interface SpacePanelSidebarContextProps {
  section: string;
  activeSpaceId: string;
  activeSpaceName: string;
  settingsSection: string;
  libraryCollection: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId: string | undefined;
  activeDrawingId: string;
  onCreateConversation: (kind: ConversationDialogKind) => void;
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

  if (props.section === "notes" && spaceNotesEnabled) {
    return <NotesPanelSidebar spaceId={props.activeSpaceId} spaceName={props.activeSpaceName} />;
  }

  if (props.section === "drawings") {
    return (
      <DrawingPanelSidebar spaceId={props.activeSpaceId} activeDrawingId={props.activeDrawingId} />
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

  if (props.section === "settings") {
    return (
      <SpaceSidebarSection title="Preferences">
        <nav className="grid gap-1" aria-label="Space settings sections">
          {settingsSidebarItems.map(({ id, label, icon }) => (
            <SpaceSidebarLink
              key={id}
              active={props.settingsSection === id}
              icon={icon}
              label={label}
              to={`${spacePath}/settings/${id}`}
            />
          ))}
        </nav>
      </SpaceSidebarSection>
    );
  }

  return null;
}
