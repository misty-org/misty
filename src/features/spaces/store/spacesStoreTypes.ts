import type {
  CreateSpaceRequest,
  CreateSpaceResult,
  Space,
  SpaceInvitation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
} from "@/api/spaces/dto/entities";
import type { SpacePresenceViewer } from "./realtimeTypes";

export interface SpacesStore {
  spaces: Space[];
  invitations: SpaceInvitation[];
  membersBySpace: Record<string, SpaceMember[]>;
  messagesBySpace: Record<string, SpaceMessage[]>;
  messageLoadingBySpace: Record<string, boolean>;
  messageErrorsBySpace: Record<string, string>;
  nodesBySpace: Record<string, SpaceNode[]>;
  presenceBySpace: Record<string, SpacePresenceViewer[]>;
  typingByConversation: Record<string, Record<string, number>>;
  snapshotReady: boolean;
  referenceOnly: boolean;
  loading: boolean;
  sending: boolean;
  error: string | null;
  load: (options?: { force?: boolean; accountId?: string }) => Promise<void>;
  loadSpace: (spaceId: string) => Promise<void>;
  loadMessages: (spaceId: string) => Promise<void>;
  loadNodes: (spaceId: string) => Promise<void>;
  loadMembers: (spaceId: string) => Promise<void>;
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
  connectRealtime: (accountId: string) => Promise<void>;
  disconnectRealtime: () => void;
  setViewingSpace: (spaceId: string) => void;
  sendTyping: (spaceId: string, conversationId: string, active: boolean) => void;
  clearError: () => void;
}
