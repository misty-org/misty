import type { GlobalAiConversation } from "@/features/global-search/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import mistyCompanion from "@/shared/assets/mist-orb-expression-cycle.webp";
import { Cable, Loader2, MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function MistyConversationSidebar(props: {
  mobile?: boolean;
  conversations: GlobalAiConversation[];
  activeConversationId: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onManageConnections: () => void;
}) {
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<GlobalAiConversation>();
  const renameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId) renameRef.current?.select();
  }, [renamingId]);

  const beginRename = (conversation: GlobalAiConversation) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title);
  };
  const finishRename = () => {
    const title = renameDraft.trim();
    if (renamingId && title) props.onRename(renamingId, title);
    setRenamingId("");
    setRenameDraft("");
  };

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-r border-charcoal-border/80 bg-charcoal-sidebar px-2 pb-2",
        props.mobile && "h-full border-r-0",
      )}
    >
      <header className="flex h-16 shrink-0 items-center gap-2.5 px-2">
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-400/10 ring-1 ring-white/5">
          <img src={mistyCompanion} alt="" className="size-9 object-contain" draggable={false} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[15px] font-semibold tracking-tight text-cream-bright">Misty</h1>
          <p className="m-0 text-[11px] text-cream-muted">Conversations and work</p>
        </div>
        {props.loading ? <Loader2 className="size-3.5 animate-spin text-cream-muted" /> : null}
      </header>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mb-2 h-9 justify-start gap-2 rounded-lg px-2.5 text-[13px] font-medium"
        onClick={props.onNew}
      >
        <MessageSquarePlus className="size-4" /> New conversation
      </Button>

      <nav
        className="misty-transient-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto"
        aria-label="Misty conversations"
      >
        {props.conversations.map((conversation) => {
          const active = props.activeConversationId === conversation.id;
          const menuItems = (
            <>
              <Pencil className="size-3.5" /> Rename
            </>
          );
          return (
            <ContextMenu key={conversation.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    "group/conversation relative flex min-h-11 items-center rounded-lg transition-colors",
                    active
                      ? "bg-charcoal-card text-cream-bright"
                      : "text-cream hover:bg-charcoal-hover",
                  )}
                >
                  {renamingId === conversation.id ? (
                    <input
                      ref={renameRef}
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={finishRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") finishRename();
                        if (event.key === "Escape") setRenamingId("");
                      }}
                      aria-label={`Rename ${conversation.title}`}
                      className={cn(
                        "mx-2 min-w-0 flex-1 rounded-md border border-cream-muted/40",
                        "bg-charcoal-bg px-2 py-1.5 text-[12px] text-cream outline-none",
                        "focus:border-cream-muted",
                      )}
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-2.5 py-2 text-left"
                      onClick={() => props.onSelect(conversation.id)}
                    >
                      <strong className="block truncate pr-5 text-[12px] font-medium">
                        {conversation.title}
                      </strong>
                      <span className="mt-0.5 block text-[10px] text-cream-muted">
                        {relativeTime(conversation.updatedAt)}
                      </span>
                    </button>
                  )}
                  {renamingId !== conversation.id ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Conversation options for ${conversation.title}`}
                          className={cn(
                            "absolute right-1 size-7 rounded-md opacity-0",
                            "group-hover/conversation:opacity-100 data-[state=open]:opacity-100",
                            "focus:opacity-100",
                          )}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        <DropdownMenuItem onSelect={() => beginRename(conversation)}>
                          {menuItems}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-notification-red focus:text-notification-red"
                          onSelect={() => setDeleteTarget(conversation)}
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                <ContextMenuItem onSelect={() => beginRename(conversation)}>
                  {menuItems}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-notification-red focus:text-notification-red"
                  onSelect={() => setDeleteTarget(conversation)}
                >
                  <Trash2 className="size-3.5" /> Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </nav>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 h-9 justify-start gap-2 border-t border-charcoal-border/70 px-2.5 text-[12px]"
        onClick={props.onManageConnections}
      >
        <Cable className="size-3.5" /> Tool connections
      </Button>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” will be removed from your history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-notification-red text-white hover:bg-notification-red/90"
              onClick={() => {
                if (deleteTarget) props.onDelete(deleteTarget.id);
                setDeleteTarget(undefined);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function relativeTime(value: string) {
  const elapsed = Date.now() - Date.parse(value);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
