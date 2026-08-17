import type {
  CreateSpaceRequest,
  CreateSpaceResult,
  Space,
  SpaceAgentMembership,
  SpaceInboxItem,
  SpaceInvitation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceRun,
  SpaceStudioResource,
  SpacesSnapshot,
} from "@/api/spaces/dto/interfaces/types";
import type { SpacePresenceViewer } from "../types/useSpacesBackendStore";

import type { ActivityTab } from "../../../../store/useSpacesStore";

export interface SpacesStore {
  spaces: Space[];
  invitations: SpaceInvitation[];
  limits: SpacesSnapshot["entitlements"] | null;
  ownerStorage: SpacesSnapshot["owner_storage"] | null;
  membersBySpace: Record<string, SpaceMember[]>;
  agentMembershipsBySpace: Record<string, SpaceAgentMembership[]>;
  messagesBySpace: Record<string, SpaceMessage[]>;
  nodesBySpace: Record<string, SpaceNode[]>;
  agentsBySpace: Record<string, SpaceStudioResource[]>;
  workflowsBySpace: Record<string, SpaceStudioResource[]>;
  inbox: Record<ActivityTab, SpaceInboxItem[]>;
  presenceBySpace: Record<string, SpacePresenceViewer[]>;
  snapshotReady: boolean;
  referenceOnly: boolean;
  lastSyncedAt: string | null;
  loading: boolean;
  sending: boolean;
  realtimeConnected: boolean;
  error: string | null;
  load: (options?: { force?: boolean; accountId?: string }) => Promise<void>;
  loadSpace: (spaceId: string) => Promise<void>;
  loadMessages: (spaceId: string) => Promise<void>;
  loadNodes: (spaceId: string) => Promise<void>;
  loadMembers: (spaceId: string) => Promise<void>;
  loadStudio: (spaceId: string, kind: "agents" | "workflows") => Promise<void>;
  loadChatAgents: (spaceId: string) => Promise<void>;
  loadInbox: () => Promise<void>;
  createSpace: (request: CreateSpaceRequest) => Promise<CreateSpaceResult>;
  renameSpace: (spaceId: string, name: string) => Promise<Space>;
  invite: (spaceId: string, email: string) => Promise<void>;
  respondInvite: (inviteId: string, accept: boolean) => Promise<void>;
  removeMember: (spaceId: string, userId: string) => Promise<void>;
  leaveSpace: (spaceId: string) => Promise<void>;
  transferOwner: (spaceId: string, userId: string) => Promise<void>;
  deleteSpace: (spaceId: string, confirmation: string) => Promise<void>;
  sendMessage: (
    spaceId: string,
    text: string,
    fileNodeIds?: string[],
    attachmentIds?: string[],
    libraryItemIds?: string[],
    replyToMessageId?: string,
    selectedAgentIdsByLabel?: Record<string, string>,
    optimisticMessage?: SpaceMessage,
  ) => Promise<void>;
  updateMessage: (
    spaceId: string,
    messageId: string,
    text: string,
    fileNodeIds?: string[],
  ) => Promise<void>;
  deleteMessage: (spaceId: string, messageId: string) => Promise<void>;
  toggleMessageReaction: (
    spaceId: string,
    messageId: string,
    emoji: string,
    reacted: boolean,
  ) => Promise<void>;
  markRead: (spaceId: string, seq: number) => Promise<void>;
  openNode: (spaceId: string, nodeId: string, disposition?: "open" | "download") => Promise<void>;
  saveStudio: (
    spaceId: string,
    kind: "agents" | "workflows",
    item: Partial<SpaceStudioResource>,
  ) => Promise<SpaceStudioResource>;
  deleteStudio: (spaceId: string, kind: "agents" | "workflows", id: string) => Promise<void>;
  runStudio: (
    spaceId: string,
    kind: "agents" | "workflows",
    id: string,
    prompt?: string,
    capabilityId?: string,
  ) => Promise<SpaceRun>;
  markInboxSeen: () => Promise<void>;
  clearInbox: (tab: ActivityTab) => Promise<void>;
  connectRealtime: (accountId: string) => Promise<void>;
  disconnectRealtime: () => void;
  setViewingSpace: (spaceId: string) => void;
  clearError: () => void;
}
