import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorNotification,
  Input,
  Label,
  Skeleton,
  Textarea,
} from "@/shared/ui";
import type { AgentProfile } from "@/shared/schemas";
import {
  currentSpaceKey,
  folderLabel,
  folderOf,
  listEngines,
  mistyEngine,
  useSpaceFolders,
} from "../engines/enginesApi";
import { draftPickUp, pickUpMarkdown, pickUpTitle, sendPickUp } from "./pickUp";

/**
 * Save where it left off: the chat's agent writes the note in its chat, the person reads and edits
 * it here, and "Send to Space" is the only step that puts it on the server.
 */
export function PickUpDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  spaceId: string;
  conversationId: string;
  chatTitle: string;
  agent: AgentProfile | undefined;
  onSent?(noteId: string): void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!props.open) return;
    let live = true;
    setTitle(pickUpTitle(props.chatTitle));
    setText("");
    setError("");
    setDrafting(true);
    draftPickUp(props.conversationId)
      .then((draft) => live && setText(draft))
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : "The draft failed.");
      })
      .finally(() => live && setDrafting(false));
    return () => {
      live = false;
    };
  }, [props.open, props.conversationId, props.chatTitle, attempt]);

  const send = async () => {
    if (sending || !text.trim()) return;
    setSending(true);
    setError("");
    try {
      const space = currentSpaceKey();
      const folders = useSpaceFolders.getState();
      const folder = folderOf(folders, space);
      const engineId = props.agent?.engine ?? "";
      const engine =
        engineId && engineId !== mistyEngine
          ? ((await listEngines().catch(() => [])).find((item) => item.id === engineId)?.name ??
            engineId)
          : "";
      const markdown = pickUpMarkdown(text, {
        agentName: props.agent?.name ?? "Agent",
        engine,
        folder: folder ? folderLabel(folders, space, folder) : "",
        at: new Date(),
      });
      const note = await sendPickUp(props.spaceId, title.trim() || pickUpTitle(""), markdown);
      props.onSent?.(note.id);
      props.onOpenChange(false);
    } catch {
      setError("That couldn't be sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Save where it left off</DialogTitle>
        </DialogHeader>
        {drafting ? (
          <div className="grid gap-2" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-4/6" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-3/6" />
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pick-up-title" className="text-2xs">
                Title
              </Label>
              <Input
                id="pick-up-title"
                value={title}
                className="h-8 text-ui"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pick-up-text" className="text-2xs">
                Note
              </Label>
              <Textarea
                id="pick-up-text"
                value={text}
                rows={14}
                className="font-mono text-xs"
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          </div>
        )}
        <ErrorNotification message={error} onDismiss={() => setError("")} />
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          {error && !text && !drafting ? (
            <Button type="button" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={drafting || sending || !text.trim()}
              onClick={() => void send()}
            >
              {sending ? "Sending…" : "Send to Space"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
