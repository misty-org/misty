import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuSeparator,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  MenuItem,
} from "@/shared/ui";

/**
 * A conversation's actions: the overflow menu, the same items for a right-click menu,
 * and the rename and delete dialogs both open.
 */
export function useConversationActions({
  conversation,
  disabled,
  onOpen,
}: {
  conversation: { id: string; title?: string };
  disabled?: boolean;
  onOpen?(): void;
}) {
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState<"rename" | "delete">();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const name = conversation.title || "Untitled conversation";
  const close = () => {
    if (!pending.current) setAction(undefined);
  };
  const submit = async () => {
    if (pending.current || disabled || !action || (action === "rename" && !title.trim())) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const store = useMistyStore.getState();
    try {
      if (action === "rename") await store.renameConversation(conversation.id, title);
      else await store.deleteConversation(conversation.id);
      if (useMistyStore.getState().accountId !== store.accountId) return;
      if (action === "delete" && params.get("conversation") === conversation.id) {
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            if (next.get("conversation") === conversation.id) next.delete("conversation");
            return next;
          },
          { replace: true },
        );
      }
      setAction(undefined);
    } catch (failure) {
      if (useMistyStore.getState().accountId === store.accountId)
        setError(globalMistyError(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const startRename = () => {
    setTitle(conversation.title || "");
    setError("");
    setAction("rename");
  };
  const startDelete = () => {
    setError("");
    setAction("delete");
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    trigger.current?.focus();
  };
  // A menu that opened a dialog leaves focus to it.
  const keepDialogFocus = (event: Event) => {
    if (action) event.preventDefault();
  };
  const dropdown = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton ref={trigger} disabled={disabled || busy} label={`More actions for ${name}`}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus}>
        {onOpen && <MenuItem label="Open" onSelect={onOpen} />}
        <MenuItem icon={<Pencil />} label="Rename" disabled={disabled} onSelect={startRename} />
        <DropdownMenuSeparator />
        <MenuItem icon={<Trash2 />} label="Delete" disabled={disabled} onSelect={startDelete} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const contextMenu = (
    <ContextMenuContent onCloseAutoFocus={keepDialogFocus}>
      {onOpen && <ContextMenuAction label="Open" onSelect={onOpen} />}
      <ContextMenuAction
        icon={<Pencil />}
        label="Rename"
        disabled={disabled || busy}
        onSelect={startRename}
      />
      <ContextMenuSeparator />
      <ContextMenuAction
        icon={<Trash2 />}
        label="Delete"
        disabled={disabled || busy}
        onSelect={startDelete}
      />
    </ContextMenuContent>
  );
  const dialogs = (
    <>
      <Dialog
        open={action === "rename"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>Choose a name for this conversation.</DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Input
              aria-label="Conversation name"
              value={title}
              maxLength={64}
              disabled={busy}
              onFocus={(event) => event.target.select()}
              onChange={(event) => setTitle(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-cream-muted">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || busy || !title.trim()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={action === "delete"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            “{name}” and its messages will be permanently deleted. Any unsent draft in this
            conversation will be discarded. This cannot be undone.
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={disabled || busy} onClick={() => void submit()}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  return { dropdown, contextMenu, dialogs };
}
