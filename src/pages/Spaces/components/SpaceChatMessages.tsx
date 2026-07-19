import type { FormEvent, RefObject } from "react";
import { Ellipsis, LibraryBig, MessageSquare, Paperclip, Pencil, Reply, Sparkles, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { copyLibraryItemsToClipboard } from "../../../spaces/libraryClipboard";
import { spacesApi } from "../../../spaces/api";
import type { MessageSpan, SpaceLibraryItem, SpaceMessage, SpaceNode } from "../../../spaces/types";
import { formatTime } from "../libraryFormat";

interface SpaceChatMessagesProps {
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

export function SpaceChatMessages(props: SpaceChatMessagesProps) {
  return (
    <div className="min-h-0 overflow-y-auto px-[clamp(20px,5vw,72px)] py-6">
      {props.error ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {props.error}
        </div>
      ) : null}
      {props.loading ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading conversation…</div>
      ) : props.messages.length === 0 ? (
        <div className="grid h-full place-items-center text-center">
          <div className="max-w-sm">
            <span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted/60"><MessageSquare /></span>
            <h2 className="mt-4 text-base font-semibold">Start the conversation</h2>
            <p className="mt-1 text-sm text-muted-foreground">Mention a teammate or shared Agent with @name.</p>
          </div>
        </div>
      ) : props.messages.map((message) => (
        <article className="group mb-6 grid grid-cols-[36px_minmax(0,1fr)_32px] gap-3" id={`message-${message.id}`} key={message.id}>
          <Avatar className="size-9">
            <AvatarFallback className="text-[11px] font-semibold">
              {message.sender_kind === "agent" ? "AI" : initials(message.sender_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong className="text-sm font-medium">{message.sender_name}{message.sender_user_id === props.currentUserId ? " (you)" : ""}</strong>
              {message.sender_kind === "agent" ? <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]"><Sparkles />Agent</Badge> : null}
              <time className="text-xs text-muted-foreground">{formatTime(message.created_at)}</time>
              {message.edited_at ? <span className="text-xs text-muted-foreground">Edited</span> : null}
            </div>
            {message.reply_to_message_id ? (
              <Button variant="link" size="sm" className="h-auto max-w-full justify-start truncate px-0 py-1 text-xs text-muted-foreground" onClick={() => document.getElementById(`message-${message.reply_to_message_id}`)?.scrollIntoView({ block: "center" })}>
                Replying to {props.messages.find((item) => item.id === message.reply_to_message_id)?.sender_name ?? "a message"}
              </Button>
            ) : null}
            {props.editingMessageId === message.id ? (
              <form className="mt-2 rounded-lg bg-muted/35 p-2" onSubmit={(event) => props.onSaveEdited(event, message)}>
                <Textarea autoFocus className="min-h-20 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0" maxLength={4000} value={props.editingText} onChange={(event) => props.onEditingText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && !props.editSaving) props.onCancelEditing(message.id); }} aria-label="Edit message" />
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" type="button" disabled={props.editSaving} onClick={() => props.onCancelEditing(message.id)}>Cancel</Button>
                  <Button size="sm" type="submit" disabled={props.editSaving || !props.editingText.trim()}>{props.editSaving ? "Saving…" : "Save"}</Button>
                </div>
              </form>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                {message.content.map((span, index) => <MessageContent key={index} span={span} />)}
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
                <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100" aria-label="Message actions"><Ellipsis /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => props.onReply(message.id)}><Reply />Reply</DropdownMenuItem>
                {message.sender_kind === "person" && message.sender_user_id === props.currentUserId ? <DropdownMenuItem onSelect={() => props.onBeginEditing(message)}><Pencil />Edit</DropdownMenuItem> : null}
                {message.sender_user_id === props.currentUserId || props.isOwner ? <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => props.onDelete(message)}><Trash2 />Delete message</DropdownMenuItem></> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </article>
      ))}
      <div ref={props.endRef} />
    </div>
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
          <AlertDialogDescription>This removes the message from the Space conversation for everyone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>Delete message</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MessageContent({ span }: { span: MessageSpan }) {
  return span.type === "text"
    ? <>{span.text}</>
    : <span className="rounded bg-primary/10 px-1 py-0.5 font-medium text-primary">@{span.label}</span>;
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
      {message.file_node_ids.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.file_node_ids.map((nodeId) => { const node = nodes.find((item) => item.id === nodeId); return <Button variant="outline" size="sm" className="h-7 text-xs" type="button" key={nodeId} onClick={() => onOpenNode(nodeId)}><Paperclip />{node?.display_name ?? "Drive file"}</Button>; })}</div> : null}
      {(message.library_item_ids?.length ?? 0) > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.library_item_ids?.map((itemId) => { const item = libraryItems.find((candidate) => candidate.id === itemId); return <Button variant="secondary" size="sm" className="h-7 text-xs" type="button" key={itemId} disabled={!item || !canCopyLibrary} title={canCopyLibrary ? "Copy to clipboard" : "Copy permission required"} onClick={() => { if (item && canCopyLibrary) void copyLibraryItemsToClipboard(spaceId, [item]).catch((error) => onError(error instanceof Error ? error.message : "The Library item could not be copied.")); }}><LibraryBig />{item?.display_name ?? "Unavailable Library item"}</Button>; })}</div> : null}
      {(message.attachments?.length ?? 0) > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.attachments?.map((attachment) => <div className="inline-flex items-center gap-1 rounded-md bg-muted/50 p-1 pl-2 text-xs" key={attachment.id}><Paperclip className="size-3" /><Button variant="link" size="sm" className="h-auto px-1 py-0 text-xs" type="button" onClick={() => void spacesApi.downloadAttachment(spaceId, attachment.id, attachment.display_name)}>{attachment.display_name}</Button>{attachment.promoted_item_id ? <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">In Library</Badge> : canAddToLibrary ? <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" type="button" onClick={() => void spacesApi.promoteAttachment(spaceId, attachment.id).then((item) => { onLibraryItem(item); onReload(); })}>Add to Library</Button> : null}</div>)}</div> : null}
    </>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
