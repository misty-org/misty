import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type {
  Space,
  SpaceConversation,
  SpaceMember,
  SpacesSnapshot,
} from "@/models/interfaces/features/spaces/types";
import {
  CreateEditConversationDialog,
  type ConversationDialogKind,
} from "./CreateEditConversationDialog";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpacePanelSidebarContext } from "./spacePanel/SpacePanelSidebarContext";
import { SpacePanelSkeleton } from "./spacePanel/SpacePanelSkeleton";
import { SpaceStorageFooter } from "./spacePanel/SpaceStorageFooter";
import { SpaceSwitcherMenu } from "./spacePanel/SpaceSwitcherMenu";
import { useSpaceLibraryUsage } from "./spacePanel/useSpaceLibraryUsage";
import { useSpacePanelConversations } from "./spacePanel/useSpacePanelConversations";
import {
  spaceConversationPath,
  spaceSectionPath,
  useSpacePanelRoute,
} from "./spacePanel/spacePanelRoute";

const emptyMembers: SpaceMember[] = [];

export function SpacePanelContent(props: {
  spaces: Space[];
  limits: SpacesSnapshot["entitlements"] | null;
  loading: boolean;
  onAddSpace: () => void;
  notices?: ReactNode;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const route = useSpacePanelRoute();
  const { activeSpaceId, section, settingsSection } = route;
  const activeSpace = props.spaces.find((space) => space.id === activeSpaceId);
  const [spacesListSkeletonVisible] = useMinimumSpin(props.loading && props.spaces.length === 0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<ConversationDialogKind>("group");
  const [editingConversation, setEditingConversation] = useState<SpaceConversation | null>(null);

  const { members, snapshotReady, loadMembers } = useSpacesStore(
    useShallow((state) => ({
      members: state.membersBySpace[activeSpaceId] ?? emptyMembers,
      snapshotReady: state.snapshotReady,
      loadMembers: state.loadMembers,
    })),
  );
  const { conversations, upsertConversation } = useSpacePanelConversations({
    activeSpaceId,
    activeSpace,
    snapshotReady,
    enabled: Boolean(user),
  });
  const libraryUsage = useSpaceLibraryUsage({ activeSpaceId, activeSpace, section, snapshotReady });

  // Land on the first Space when the route points at one that is not loaded.
  useEffect(() => {
    if (props.loading || activeSpace || props.spaces.length === 0) return;
    navigate(spaceSectionPath(props.spaces[0].id, section, settingsSection), { replace: true });
  }, [activeSpace, navigate, props.loading, props.spaces, section, settingsSection]);

  useEffect(() => {
    if (!user || !snapshotReady || !activeSpaceId || !activeSpace) return;
    void loadMembers(activeSpaceId);
  }, [activeSpace, activeSpaceId, loadMembers, snapshotReady, user]);

  const handleConversationSaved = (saved: SpaceConversation) => {
    upsertConversation(saved);
    navigate(spaceConversationPath(activeSpaceId, saved.id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SpaceSwitcherMenu
        spaces={props.spaces}
        activeSpace={activeSpace}
        activeSpaceId={activeSpaceId}
        canAddSpace={props.limits?.unlimited_spaces !== false}
        onAddSpace={props.onAddSpace}
        onSwitchSpace={(spaceId) => {
          if (!spaceId || spaceId === activeSpaceId) return;
          navigate(spaceSectionPath(spaceId, section, settingsSection));
        }}
      />

      {spacesListSkeletonVisible ? <SpacePanelSkeleton /> : null}
      {props.notices ? (
        <div className="misty-transient-scrollbar mb-3 max-h-40 shrink-0 overflow-y-auto">
          {props.notices}
        </div>
      ) : null}

      {activeSpaceId ? (
        <>
          <SpaceSectionNavigation
            spaceId={activeSpaceId}
            section={section}
            context={
              <SpacePanelSidebarContext
                section={section}
                activeSpaceId={activeSpaceId}
                activeSpaceName={activeSpace?.name ?? "Journal"}
                settingsSection={settingsSection}
                libraryCollection={route.libraryCollection}
                conversations={conversations}
                activeConversationId={route.conversationId}
                currentUserId={user?.id}
                activeDrawingId={route.drawingId}
                onCreateConversation={(kind) => {
                  setEditingConversation(null);
                  setDialogKind(kind);
                  setDialogOpen(true);
                }}
                onEditConversation={(conversation) => {
                  setEditingConversation(conversation);
                  setDialogKind(conversation.members.length > 2 ? "group" : "direct");
                  setDialogOpen(true);
                }}
              />
            }
          />
          <SpaceStorageFooter
            usage={libraryUsage}
            showsOwnerStorage={activeSpace?.owner_user_id === user?.id}
          />
        </>
      ) : null}

      <CreateEditConversationDialog
        spaceId={activeSpaceId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        members={members}
        currentUserId={user?.id}
        conversation={editingConversation}
        kindHint={dialogKind}
        onSaved={handleConversationSaved}
      />
    </div>
  );
}
