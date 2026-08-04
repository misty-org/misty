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
} from "@/models/interfaces/features/spaces/types";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { SpaceManagementNavigation } from "./SpaceManagementNavigation";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpacePanelSidebarContext } from "./spacePanel/SpacePanelSidebarContext";
import { SpacePanelSkeleton } from "./spacePanel/SpacePanelSkeleton";
import { SpaceSidebarHeader } from "./spacePanel/SpaceSidebarHeader";
import { SpaceStorageFooter } from "./spacePanel/SpaceStorageFooter";
import { useSpaceLibraryUsage } from "./spacePanel/useSpaceLibraryUsage";
import { useSpacePanelConversations } from "./spacePanel/useSpacePanelConversations";
import {
  spaceConversationPath,
  spaceSectionPath,
  useSpacePanelRoute,
} from "./spacePanel/spacePanelRoute";
import { isMistySpace } from "../mistySpace";

const emptyMembers: SpaceMember[] = [];

export function SpacePanelContent(props: {
  spaces: Space[];
  loading: boolean;
  notices?: ReactNode;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const route = useSpacePanelRoute();
  const { activeSpaceId, section, settingsSection } = route;
  const activeSpace = props.spaces.find((space) => space.id === activeSpaceId);
  const [spacesListSkeletonVisible] = useMinimumSpin(props.loading && props.spaces.length === 0);
  const [dialogOpen, setDialogOpen] = useState(false);
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
  const mistySpace = isMistySpace(activeSpace);
  const supportConversation = conversations.find(
    (conversation) =>
      conversation.kind === "misty_support" ||
      conversation.id === activeSpace?.support_conversation_id,
  );

  // Land on the first Space when the route points at one that is not loaded.
  useEffect(() => {
    if (!activeSpaceId || props.loading || activeSpace || props.spaces.length === 0) return;
    navigate(spaceSectionPath(props.spaces[0].id, section, settingsSection), { replace: true });
  }, [activeSpace, activeSpaceId, navigate, props.loading, props.spaces, section, settingsSection]);

  useEffect(() => {
    if (!user || !snapshotReady || !activeSpaceId || !activeSpace || mistySpace) return;
    void loadMembers(activeSpaceId);
  }, [activeSpace, activeSpaceId, loadMembers, mistySpace, snapshotReady, user]);

  useEffect(() => {
    if (!mistySpace) return;
    if (section !== "chat") {
      navigate(
        supportConversation
          ? spaceConversationPath(activeSpaceId, supportConversation.id)
          : `/spaces/${encodeURIComponent(activeSpaceId)}/chat`,
        { replace: true },
      );
      return;
    }
    if (!supportConversation || route.conversationId === supportConversation.id) return;
    navigate(spaceConversationPath(activeSpaceId, supportConversation.id), { replace: true });
  }, [activeSpaceId, mistySpace, navigate, route.conversationId, section, supportConversation]);

  const handleConversationSaved = (saved: SpaceConversation) => {
    upsertConversation(saved);
    navigate(spaceConversationPath(activeSpaceId, saved.id));
  };

  const activeSpaceNavigation = activeSpaceId ? (
    <SpacePanelSidebarContext
      section={section}
      plannerSection={route.plannerSection}
      roadmapId={route.roadmapId}
      activeSpaceId={activeSpaceId}
      activeSpaceName={activeSpace?.name ?? "Journal"}
      settingsSection={settingsSection}
      libraryCollection={route.libraryCollection}
      conversations={
        mistySpace ? (supportConversation ? [supportConversation] : []) : conversations
      }
      activeConversationId={route.conversationId}
      currentUserId={user?.id}
      activeDrawingId={route.drawingId}
      supportOnly={mistySpace}
      onCreateConversation={
        mistySpace
          ? undefined
          : () => {
              setEditingConversation(null);
              setDialogOpen(true);
            }
      }
      onEditConversation={
        mistySpace
          ? undefined
          : (conversation) => {
              setEditingConversation(conversation);
              setDialogOpen(true);
            }
      }
    />
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {activeSpace ? (
        <SpaceSidebarHeader
          space={activeSpace}
          actions={<SpaceManagementNavigation space={activeSpace} section={section} />}
        />
      ) : null}

      {props.notices ? (
        <div className="misty-transient-scrollbar mb-3 max-h-40 shrink-0 overflow-y-auto">
          {props.notices}
        </div>
      ) : null}

      {spacesListSkeletonVisible ? (
        <SpacePanelSkeleton />
      ) : activeSpaceId ? (
        <>
          <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2 [overscroll-behavior:contain]">
            <SpaceSectionNavigation spaceId={activeSpaceId} section={section} />
            {activeSpaceNavigation ? (
              <div className="mt-3 border-t border-sidebar-border/45 pt-3">
                {activeSpaceNavigation}
              </div>
            ) : null}
          </div>
          {!mistySpace ? (
            <SpaceStorageFooter
              usage={libraryUsage}
              showsOwnerStorage={activeSpace?.owner_user_id === user?.id}
            />
          ) : null}
        </>
      ) : null}

      {!mistySpace ? (
        <CreateEditConversationDialog
          spaceId={activeSpaceId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          members={members}
          currentUserId={user?.id}
          conversation={editingConversation}
          onSaved={handleConversationSaved}
        />
      ) : null}
    </div>
  );
}
