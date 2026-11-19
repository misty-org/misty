import type { FormEvent, RefObject, UIEventHandler } from "react";
import type { SpaceLibraryItem, SpaceMessage, SpaceNode } from "../../api/dto/entities";

export type SpaceChatStarter = "mention" | "files" | "library";

export interface SpaceChatMessagesProps {
  onRetry?: (message: SpaceMessage) => void;
  error: string;
  loading: boolean;
  messages: SpaceMessage[];
  currentUserId?: string;
  isOwner: boolean;
  canWrite: boolean;
  editingMessageId: string;
  editingText: string;
  editSaving: boolean;
  nodes: SpaceNode[];
  libraryItems: SpaceLibraryItem[];
  spaceId: string;
  endRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  /** Older messages may still be on the server, before the first one shown. */
  hasOlderMessages?: boolean;
  /** Brings a message that isn't drawn yet into view, reading further back for it. */
  onJumpToMessage?: (messageId: string) => void;
  onEditingText: (value: string) => void;
  onCancelEditing: (messageId: string) => void;
  onSaveEdited: (event: FormEvent, message: SpaceMessage) => void;
  onReply: (messageId: string) => void;
  onToggleReaction: (message: SpaceMessage, emoji: string, reacted: boolean) => void;
  onBeginEditing: (message: SpaceMessage) => void;
  onDelete: (message: SpaceMessage) => void;
  onOpenNode: (nodeId: string) => void;
  onError: (message: string) => void;
  onLibraryItem: (item: SpaceLibraryItem) => void;
  onReload: () => void;
  directRecipient?: { userId: string; name: string };
  onStarter?: (starter: SpaceChatStarter) => void;
  /** The reader's roles, so a message mentioning one of them is marked. */
  myRoleIds?: string[];
  /** Deleting other people's messages here (`messages.manage`). */
  canManageMessages?: boolean;
  /** Each member's name color, from their highest colored role. */
  memberColors?: Map<string, string>;
  /** The first message the person hadn't read when the chat opened. */
  firstUnreadId?: string;
  /** The open channel, for its welcome at the top of its history; none for a direct message. */
  channel?: { name: string; private: boolean };
}

export { DeleteMessageDialog } from "./DeleteMessageDialog";
