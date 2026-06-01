import { useAuth } from "@/features/auth";
import { useConnectionsStore } from "@/features/integrations";
import { spacesApi } from "@/api/spaces/api";
import type {
  Space,
  SpaceAgentMembership,
  SpaceConversation,
  SpaceMember,
} from "@/api/spaces/dto/interfaces/types";
import type { SocialProviderId } from "@/api/social";
import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { cn } from "@/shared/ui";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { preferredMistySpace } from "../mistySpace";
import { socialProvider, socialProviderPath } from "../social/socialRoute";
import { useSpacesStore } from "../store/useSpacesStore";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { SpacePanelSidebarContext } from "./spacePanel/SpacePanelSidebarContext";
import { SpacePanelSkeleton } from "./spacePanel/SpacePanelSkeleton";
import {
  spaceConversationPath,
  spaceSectionPath,
  useSpacePanelRoute,
} from "./spacePanel/spacePanelRoute";
import { useSpacePanelConversations } from "./spacePanel/useSpacePanelConversations";

const emptyMembers: SpaceMember[] = [];
const emptyAgents: SpaceAgentMembership[] = [];
let refreshSocialConnectionsAfterAuthorization = false;

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
  const {
    accountId: connectionsAccountId,
    connections: accountConnections,
    loading: connectionsLoading,
    authorizingProvider,
    setAccount: setConnectionsAccount,
    load: loadConnections,
    beginAuthorization,
    clearError: clearConnectionsError,
  } = useConnectionsStore(
    useShallow((state) => ({
      accountId: state.accountId,
      connections: state.connections,
      loading: state.loading,
      authorizingProvider: state.authorizingProvider,
      setAccount: state.setAccount,
      load: state.load,
      beginAuthorization: state.beginAuthorization,
      clearError: state.clearError,
    })),
  );

  useEffect(() => {
    if (section !== "social" || !user?.id) return;
    setConnectionsAccount(user.id);
    const force = refreshSocialConnectionsAfterAuthorization;
    refreshSocialConnectionsAfterAuthorization = false;
    void loadConnections({ force });
    const refresh = () => void loadConnections({ force: true });
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [loadConnections, section, setConnectionsAccount, user?.id]);

  const connectSocialAccount = async (provider: Exclude<SocialProviderId, "misty">) => {
    clearConnectionsError();
    try {
      const authorizationUrl = await beginAuthorization(
        provider,
        ["social_read", "social_send", "social_automation"],
        socialProviderPath(activeSpaceId, provider),
      );
      const openResult = await openProviderAuthorizationLink(authorizationUrl);
      if (openResult?.strategy === "misty-browser") {
        refreshSocialConnectionsAfterAuthorization = true;
      }
    } catch {
      // The connections store retains a user-safe failure message.
    }
  };

  const connectedSocialAccounts =
    connectionsAccountId === user?.id
      ? accountConnections.filter((connection) => {
          const provider = socialProvider(connection.provider);
          return provider !== null && provider !== "misty";
        })
      : [];

  // Land on the first Space when the route points at one that is not loaded.
  useEffect(() => {
    if (!activeSpaceId || props.loading || activeSpace || props.spaces.length === 0) return;
    const fallback = preferredMistySpace(props.spaces);
    if (fallback) {
      const fallbackRoute =
        section === "social"
          ? socialProviderPath(fallback.id, route.socialProvider)
          : spaceSectionPath(fallback.id, section, settingsSection);
      navigate(fallbackRoute, { replace: true });
    }
  }, [
    activeSpace,
    activeSpaceId,
    navigate,
    props.loading,
    props.spaces,
    route.socialProvider,
    section,
    settingsSection,
  ]);

  useEffect(() => {
    if (!user || !snapshotReady || !activeSpaceId || !activeSpace) return;
    // Stale routes can lose access between the snapshot and this request. The
    // store repairs those with a fresh snapshot; other request failures should
    // not become unhandled promise rejections in the desktop webview.
    void loadMembers(activeSpaceId).catch(() => undefined);
  }, [activeSpace, activeSpaceId, loadMembers, snapshotReady, user]);

  const handleConversationSaved = (saved: SpaceConversation) => {
    upsertConversation(saved);
    navigate(
      spaceConversationPath(activeSpaceId, saved.id, socialProvider(saved.origin) ?? "misty"),
    );
  };

  const handleConversationDeleted = async (conversation: SpaceConversation) => {
    if (!window.confirm(`Delete “${conversation.title}” and all of its messages?`)) return;
    try {
      await spacesApi.deleteOrClearConversation(activeSpaceId, conversation.id);
      removeConversation(conversation.id);
      if (route.conversationId === conversation.id) {
        navigate(socialProviderPath(activeSpaceId, route.socialProvider), { replace: true });
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
      activeSpaceId={activeSpaceId}
      socialProvider={route.socialProvider}
      conversations={conversations}
      activeConversationId={route.conversationId}
      currentUserId={user?.id}
      onCreateConversation={
        activeSpace?.kind === "misty"
          ? undefined
          : () => {
              setEditingConversation(null);
              setDialogOpen(true);
            }
      }
      onEditConversation={(conversation) => {
        setEditingConversation(conversation);
        setDialogOpen(true);
      }}
      onDeleteConversation={(conversation) => void handleConversationDeleted(conversation)}
      isSpaceOwner={activeSpace?.role === "owner"}
      isMistySpace={activeSpace?.kind === "misty"}
      socialAccounts={connectedSocialAccounts}
      socialAccountsLoading={connectionsLoading}
      socialAuthorizingProvider={authorizingProvider}
      onConnectSocialAccount={(provider) => void connectSocialAccount(provider)}
    />
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {props.notices ? (
        <div className="misty-transient-scrollbar mb-3 max-h-40 shrink-0 overflow-y-auto">
          {props.notices}
        </div>
      ) : null}

      {spacesListSkeletonVisible ? (
        <SpacePanelSkeleton />
      ) : activeSpaceId ? (
        <div
          className={cn(
            "-mx-3 min-h-0 flex-1 px-3 pb-2",
            section === "social"
              ? "flex flex-col overflow-hidden"
              : "misty-transient-scrollbar overflow-x-hidden overflow-y-auto [overscroll-behavior:contain]",
          )}
        >
          {activeSpaceNavigation}
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
