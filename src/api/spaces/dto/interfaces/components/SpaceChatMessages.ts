import type { FormEvent, RefObject, UIEventHandler } from "react";
import type {
  SpaceActionSuggestionBatch,
  SpaceLibraryItem,
  SpaceMessage,
  SpaceNode,
} from "../types";

export interface SpaceChatMessagesProps {
  error: string;
  loading: boolean;
  messages: SpaceMessage[];
  /** Agent turns still in flight; drives the typing indicator. */
  pendingAgentRuns?: { triggerId: string; runId: string; agentId: string }[];
  actionSuggestions?: SpaceActionSuggestionBatch[];
  onActionSuggestionsChanged?: () => void;
  currentUserId?: string;
  isOwner: boolean;
  canWrite: boolean;
  editingMessageId: string;
  editingText: string;
  editSaving: boolean;
  nodes: SpaceNode[];
  libraryItems: SpaceLibraryItem[];
  canCopyLibrary: boolean;
  canAddToLibrary: boolean;
  spaceId: string;
  endRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
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
  /** Names the empty conversation, e.g. "What should we work on in Design?". */
  spaceName?: string;
  /**
   * The other person in a one-on-one conversation. When set, the empty state
   * shows the direct-message intro (avatar + "beginning of your history")
   * instead of the generic Space starters.
   */
  directRecipient?: { userId: string; name: string };
  /** Runs an opening move from the empty state. Omitted when the viewer cannot write. */
  onStarter?: (starter: SpaceChatStarter) => void;
}

export type SpaceChatStarter = "mention" | "files" | "library";
