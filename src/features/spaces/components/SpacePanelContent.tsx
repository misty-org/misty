import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  Space,
  SpaceAgentMembership,
  SpaceConversation,
  SpaceMember,
} from "@/models/interfaces/features/spaces/types";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { SpaceManagementNavigation } from "./SpaceManagementNavigation";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpacePanelSidebarContext } from "./spacePanel/SpacePanelSidebarContext";
import { SpacePanelSkeleton } from "./spacePanel/SpacePanelSkeleton";
import { SpaceSidebarHeader } from "./spacePanel/SpaceSidebarHeader";
import { useSpacePanelConversations } from "./spacePanel/useSpacePanelConversations";
import {
  spaceConversationPath,
  spaceSectionPath,
  useSpacePanelRoute,
} from "./spacePanel/spacePanelRoute";
import { preferredMistySpace } from "../mistySpace";

const emptyMembers: SpaceMember[] = [];
const emptyAgents: SpaceAgentMembership[] = [];

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

  const { members, agents, snapshotReady, loadMembers } = useSpacesStore(
    useShallow((state) => ({
      members: state.membersBySpace[activeSpaceId] ?? emptyMembers,
      agents: state.agentMembershipsBySpace[activeSpaceId] ?? emptyAgents,
      snapshotReady: state.snapshotReady,
      loadMembers: state.loadMembers,
    })),
  );
  const { conversations, upsertConversation, removeConversation } = useSpacePanelConversations({
    activeSpaceId,
    activeSpace,
    snapshotReady,
    enabled: Boolean(user),
  });

  // Land on the first Space when the route points at one that is not loaded.
  useEffect(() => {
    if (!activeSpaceId || props.loading || activeSpace || props.spaces.length === 0) return;
    const fallback = preferredMistySpace(props.spaces);
    if (fallback)
      navigate(spaceSectionPath(fallback.id, section, settingsSection), { replace: true });
  }, [activeSpace, activeSpaceId, navigate, props.loading, props.spaces, section, settingsSection]);

  useEffect(() => {
    if (!user || !snapshotReady || !activeSpaceId || !activeSpace) return;
    // Stale routes can lose access between the snapshot and this request. The
    // store repairs those with a fresh snapshot; other request failures should
    // not become unhandled promise rejections in the desktop webview.
    void loadMembers(activeSpaceId).catch(() => undefined);
  }, [activeSpace, activeSpaceId, loadMembers, snapshotReady, user]);

  const handleConversationSaved = (saved: SpaceConversation) => {
    upsertConversation(saved);
    navigate(spaceConversationPath(activeSpaceId, saved.id));
  };

  const handleConversationDeleted = async (conversation: SpaceConversation) => {
    if (!window.confirm(`Delete “${conversation.title}” and all of its messages?`)) return;
    try {
      await spacesApi.deleteOrClearConversation(activeSpaceId, conversation.id);
      removeConversation(conversation.id);
      if (route.conversationId === conversation.id) {
        navigate(spaceSectionPath(activeSpaceId, "chat", settingsSection), { replace: true });
      }
    } catch (reason) {
      window.alert(
        reason instanceof Error ? reason.message : "The conversation could not be deleted.",
      );
    }
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
      conversations={conversations}
      activeConversationId={route.conversationId}
      currentUserId={user?.id}
      activeDrawingId={route.drawingId}
      onCreateConversation={() => {
        setEditingConversation(null);
        setDialogOpen(true);
      }}
      onEditConversation={(conversation) => {
        setEditingConversation(conversation);
        setDialogOpen(true);
      }}
      onDeleteConversation={(conversation) => void handleConversationDeleted(conversation)}
      isSpaceOwner={activeSpace?.role === "owner"}
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
        <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2 [overscroll-behavior:contain]">
          <SpaceSectionNavigation spaceId={activeSpaceId} section={section} />
          {activeSpaceNavigation ? (
            <div className="mt-3 border-t border-charcoal-border/45 pt-3">
              {activeSpaceNavigation}
            </div>
          ) : null}
        </div>
      ) : null}

      <CreateEditConversationDialog
        spaceId={activeSpaceId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        members={members}
        agents={agents}
        currentUserId={user?.id}
        conversation={editingConversation}
        onSaved={handleConversationSaved}
      />
    </div>
  );
}
