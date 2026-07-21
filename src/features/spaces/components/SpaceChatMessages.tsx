import type {
  SpaceChatMessagesProps,
  SpaceChatStarter,
} from "@/models/interfaces/features/spaces/components/SpaceChatMessages";
export type {
  SpaceChatMessagesProps,
  SpaceChatStarter,
} from "@/models/interfaces/features/spaces/components/SpaceChatMessages";
import type { FormEvent, RefObject } from "react";
import {
  AtSign,
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
import { Skeleton } from "@/ui";
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
import { SiDiscord } from "react-icons/si";

import { MessageOriginBadge } from "@/features/spaces/components/MessageOriginBadge";
import { SpaceChatStarters } from "./SpaceChatStarters";
import { copyLibraryItemsToClipboard } from "@/features/spaces/libraryClipboard";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { MessageSpan } from "@/models/types/features/spaces/types";
import type {
  SpaceLibraryItem,
  SpaceMessage,
  SpaceNode,
} from "@/models/interfaces/features/spaces/types";
import { formatTime } from "../libraryFormat";

export function SpaceChatMessages(props: SpaceChatMessagesProps) {
  return (
    <div className="min-h-0 overflow-y-auto px-[clamp(20px,5vw,72px)] py-6">
      {props.error ? (
        <div
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {props.error}
        </div>
      ) : null}
      {props.loading ? (
        <div aria-busy="true" role="status">
          <span className="sr-only">Loading conversation</span>
          {messageSkeletonWidths.map((widths, index) => (
            <div className="mb-6 grid grid-cols-[36px_minmax(0,1fr)_32px] gap-3" key={index}>
              <Skeleton className="size-9 rounded-full" />
              <div className="grid min-w-0 gap-2">
                <Skeleton className="h-3.5 rounded" style={{ width: widths.name }} />
                <Skeleton className="h-4 rounded" style={{ width: widths.line1 }} />
                {widths.line2 ? (
                  <Skeleton className="h-4 rounded" style={{ width: widths.line2 }} />
                ) : null}
              </div>
              <div />
            </div>
          ))}
        </div>
      ) : props.messages.length === 0 ? (
        <SpaceChatStarters
          spaceName={props.spaceName}
          onStarter={props.canWrite ? props.onStarter : undefined}
        />
      ) : (
        props.messages.map((message) => (
          <article
            className="group mb-6 grid grid-cols-[36px_minmax(0,1fr)_32px] gap-3"
            id={`message-${message.id}`}
            key={message.id}
          >
            <Avatar className="size-9">
              <AvatarFallback className="text-[11px] font-semibold">
                {message.sender_kind === "agent" ? "AI" : initials(message.sender_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong className="text-sm font-medium">
                  {message.sender_name}
                  {message.sender_user_id === props.currentUserId ? " (you)" : ""}
                </strong>
                {message.sender_kind === "agent" ? (
                  <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                    <Sparkles />
                    {message.sender_name.toLocaleLowerCase() === "mika" ? "Mika" : "Assistant"}
                  </Badge>
                ) : null}
                <MessageOriginBadge origin={message.origin} />
                <time className="text-xs text-muted-foreground">
                  {formatTime(message.created_at)}
                </time>
                {message.edited_at ? (
                  <span className="text-xs text-muted-foreground">Edited</span>
                ) : null}
              </div>
              {message.reply_to_message_id ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto max-w-full justify-start truncate px-0 py-1 text-xs text-muted-foreground"
                  onClick={() =>
                    document
                      .getElementById(`message-${message.reply_to_message_id}`)
                      ?.scrollIntoView({ block: "center" })
                  }
                >
                  Replying to{" "}
                  {props.messages.find((item) => item.id === message.reply_to_message_id)
                    ?.sender_name ?? "a message"}
                </Button>
              ) : null}
              {props.editingMessageId === message.id ? (
                <form
                  className="mt-2 rounded-lg bg-muted/35 p-2"
                  onSubmit={(event) => props.onSaveEdited(event, message)}
                >
                  <Textarea
                    autoFocus
                    className="min-h-20 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
                    maxLength={4000}
                    value={props.editingText}
                    onChange={(event) => props.onEditingText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !props.editSaving)
                        props.onCancelEditing(message.id);
                    }}
                    aria-label="Edit message"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={props.editSaving}
                      onClick={() => props.onCancelEditing(message.id)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      type="submit"
                      disabled={props.editSaving || !props.editingText.trim()}
                    >
                      {props.editSaving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                  {message.content.map((span, index) => (
                    <MessageContent key={index} span={span} />
                  ))}
                </p>
              )}
              <MessageAttachments
                message={message}
                nodes={props.nodes}
                libraryItems={props.libraryItems}
                canCopyLibrary={props.canCopyLibrary}
                canAddToLibrary={props.canAddToLibrary}
                spaceId={props.spaceId}
                onOpenNode={props.onOpenNode}
                onError={props.onError}
                onLibraryItem={props.onLibraryItem}
                onReload={props.onReload}
              />
            </div>
            {props.canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                    aria-label="Message actions"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => props.onReply(message.id)}>
                    <Reply />
                    Reply
                  </DropdownMenuItem>
                  {props.onPublishToDiscord && canPublish(message, props.currentUserId) ? (
                    <DropdownMenuItem
                      disabled={props.publishingMessageId === message.id}
                      onSelect={() => props.onPublishToDiscord?.(message)}
                    >
                      <SiDiscord />
                      {message.origin?.publish_state === "published"
                        ? "Send to Discord again"
                        : "Send to Discord"}
                    </DropdownMenuItem>
                  ) : null}
                  {message.sender_kind === "person" &&
                  message.sender_user_id === props.currentUserId ? (
                    <DropdownMenuItem onSelect={() => props.onBeginEditing(message)}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                  ) : null}
                  {message.sender_user_id === props.currentUserId || props.isOwner ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => props.onDelete(message)}
                      >
                        <Trash2 />
                        Delete message
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </article>
        ))
      )}
      <div ref={props.endRef} />
    </div>
  );
}

/**
 * Only a person's own Misty message may be mirrored outward. Agent output,
 * system notices, and messages that arrived *from* Discord are never republished
 * — that is what keeps the mirror from looping.
 */
function canPublish(message: SpaceMessage, currentUserId?: string) {
  return (
    message.sender_kind === "person" &&
    message.sender_user_id === currentUserId &&
    (message.origin?.system ?? "misty") === "misty"
  );
}

export function DeleteMessageDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this message?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the message from the Space conversation for everyone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            Delete message
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MessageContent({ span }: { span: MessageSpan }) {
  return span.type === "text" ? (
    <>{span.text}</>
  ) : (
    <span className="rounded bg-primary/10 px-1 py-0.5 font-medium text-primary">
      @{span.label}
    </span>
  );
}

function MessageAttachments({
  message,
  nodes,
  libraryItems,
  canCopyLibrary,
  canAddToLibrary,
  spaceId,
  onOpenNode,
  onError,
  onLibraryItem,
  onReload,
}: {
  message: SpaceMessage;
  nodes: SpaceNode[];
  libraryItems: SpaceLibraryItem[];
  canCopyLibrary: boolean;
  canAddToLibrary: boolean;
  spaceId: string;
  onOpenNode: (nodeId: string) => void;
  onError: (message: string) => void;
  onLibraryItem: (item: SpaceLibraryItem) => void;
  onReload: () => void;
}) {
  return (
    <>
      {message.file_node_ids.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.file_node_ids.map((nodeId) => {
            const node = nodes.find((item) => item.id === nodeId);
            return (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                type="button"
                key={nodeId}
                onClick={() => onOpenNode(nodeId)}
              >
                <Paperclip />
                {node?.display_name ?? "Drive file"}
              </Button>
            );
          })}
        </div>
      ) : null}
      {(message.library_item_ids?.length ?? 0) > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.library_item_ids?.map((itemId) => {
            const item = libraryItems.find((candidate) => candidate.id === itemId);
            return (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                type="button"
                key={itemId}
                disabled={!item || !canCopyLibrary}
                title={canCopyLibrary ? "Copy to clipboard" : "Copy permission required"}
                onClick={() => {
                  if (item && canCopyLibrary)
                    void copyLibraryItemsToClipboard(spaceId, [item]).catch((error) =>
                      onError(
                        error instanceof Error
                          ? error.message
                          : "The Library item could not be copied.",
                      ),
                    );
                }}
              >
                <LibraryBig />
                {item?.display_name ?? "Unavailable Library item"}
              </Button>
            );
          })}
        </div>
      ) : null}
      {(message.attachments?.length ?? 0) > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.attachments?.map((attachment) => (
            <div
              className="inline-flex items-center gap-1 rounded-md bg-muted/50 p-1 pl-2 text-xs"
              key={attachment.id}
            >
              <Paperclip className="size-3" />
              <Button
                variant="link"
                size="sm"
                className="h-auto px-1 py-0 text-xs"
                type="button"
                onClick={() =>
                  void spacesApi.downloadAttachment(spaceId, attachment.id, attachment.display_name)
                }
              >
                {attachment.display_name}
              </Button>
              {attachment.promoted_item_id ? (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  In Library
                </Badge>
              ) : canAddToLibrary ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  type="button"
                  onClick={() =>
                    void spacesApi.promoteAttachment(spaceId, attachment.id).then((item) => {
                      onLibraryItem(item);
                      onReload();
                    })
                  }
                >
                  Add to Library
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

const messageSkeletonWidths: { name: string; line1: string; line2?: string }[] = [
  { name: "30%", line1: "70%", line2: "45%" },
  { name: "22%", line1: "50%" },
  { name: "26%", line1: "85%", line2: "60%" },
  { name: "20%", line1: "35%" },
];

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
