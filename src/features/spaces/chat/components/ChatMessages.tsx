import type { FormEvent, ReactNode, RefObject, UIEventHandler } from "react";
import type { SpaceMessage, SpaceNode } from "../../api/dto/entities";

export type SpaceChatStarter = "mention" | "files" | "space";

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
  spaceId: string;
  endRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  hasOlderMessages?: boolean;
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
  onReload: () => void;
  directRecipient?: { userId: string; name: string };
  onStarter?: (starter: SpaceChatStarter) => void;
  myRoleIds?: string[];
  canManageMessages?: boolean;
  memberColors?: Map<string, string>;
  firstUnreadId?: string;
  channel?: { name: string; private: boolean };
  welcome?: ReactNode;
}

export { DeleteMessageDialog } from "./DeleteMessageDialog";
