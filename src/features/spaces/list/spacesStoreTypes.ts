import type {
  CreateSpaceRequest,
  CreateSpaceResult,
  Space,
  SpaceInvitation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
} from "../api/dto/entities";
import type { SpaceMessageHistory } from "../chat/useSpaceMessageSpansStore";
import type { SpacePresenceViewer } from "./realtimeTypes";

export interface SpacesStore {
  spaces: Space[];
  invitations: SpaceInvitation[];
  membersBySpace: Record<string, SpaceMember[]>;
  messagesBySpace: Record<string, SpaceMessage[]>;
  messageLoadingBySpace: Record<string, boolean>;
  messageErrorsBySpace: Record<string, string>;
  /** How far back each Space's Everyone chat can still read. */
  messageHistoryBySpace: Record<string, SpaceMessageHistory>;
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
  /** Reads the page of Everyone before the oldest message it shows. */
  loadOlderMessages: (spaceId: string) => Promise<void>;
  loadNodes: (spaceId: string) => Promise<void>;
  loadMembers: (spaceId: string) => Promise<void>;
  createSpace: (request: CreateSpaceRequest) => Promise<CreateSpaceResult>;
  renameSpace: (spaceId: string, name: string) => Promise<Space>;
  /** Answers with the invitation's link for the owner to pass on. */
  invite: (spaceId: string, email: string) => Promise<string>;
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
  ) => Promise<SpaceMessage | undefined>;
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
