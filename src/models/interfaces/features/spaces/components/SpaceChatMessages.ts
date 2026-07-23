import type { FormEvent, RefObject } from "react";
import {
  Ellipsis,
  LibraryBig,
  MessageSquare,
  Paperclip,
  Pencil,
  Reply,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import { Textarea } from "@/ui";
import { copyLibraryItemsToClipboard } from "@/features/spaces/libraryClipboard";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { MessageSpan } from "@/models/types/features/spaces/types";
import type {
  SpaceLibraryItem,
  SpaceMessage,
  SpaceNode,
} from "@/models/interfaces/features/spaces/types";
import { formatTime } from "@/features/spaces/libraryFormat";

export interface SpaceChatMessagesProps {
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
  canCopyLibrary: boolean;
  canAddToLibrary: boolean;
  spaceId: string;
  endRef: RefObject<HTMLDivElement>;
  onEditingText: (value: string) => void;
  onCancelEditing: (messageId: string) => void;
  onSaveEdited: (event: FormEvent, message: SpaceMessage) => void;
  onReply: (messageId: string) => void;
  onBeginEditing: (message: SpaceMessage) => void;
  onDelete: (message: SpaceMessage) => void;
  onOpenNode: (nodeId: string) => void;
  onError: (message: string) => void;
  onLibraryItem: (item: SpaceLibraryItem) => void;
  onReload: () => void;
  /**
   * Publishes one message to the linked Discord channel. Omitted when the Space
   * has no outbound link, which is how the action stays hidden rather than
   * appearing and failing.
   */
  onPublishToDiscord?: (message: SpaceMessage) => void;
  /** Message id currently being published, so the row can show progress. */
  publishingMessageId?: string;
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
