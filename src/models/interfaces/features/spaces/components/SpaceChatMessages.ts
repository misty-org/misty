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
}
