import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
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
  mistyEngine,
  useEnginesList,
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
  // The engine's name for the note, from the list this computer last read.
  const engines = useEnginesList();

  useEffect(() => {
    if (!props.open) return;
    let live = true;
    setTitle(pickUpTitle(props.chatTitle));
    setText("");
    setError("");
    setDrafting(true);
    // The note fills in as the agent writes it, so a slow agent is plainly still at work.
    draftPickUp(props.conversationId, (sofar) => live && setText(sofar))
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
          ? (engines.data?.find((item) => item.id === engineId)?.name ?? engineId)
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
      <DialogContent className="max-w-140">
        <DialogHeader>
          <DialogTitle className="text-sm">Save where it left off</DialogTitle>
        </DialogHeader>
        {/* The title is known at once; only the note waits on the agent writing it. */}
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pick-up-title" className="text-2xs">
              Title
            </Label>
            <Input
              id="pick-up-title"
              value={title}
              className="text-ui"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pick-up-text" className="text-2xs">
              Note
            </Label>
            {drafting && !text ? (
              <Skeleton className="h-75 rounded-lg" />
            ) : (
              <Textarea
                id="pick-up-text"
                value={text}
                rows={14}
                // Read-only while the agent is still writing it.
                readOnly={drafting}
                aria-busy={drafting || undefined}
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </div>
        </div>
        <FieldError message={error} />
        <DialogFooter>
          <Button type="button" variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          {error && !text && !drafting ? (
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          ) : (
            <Button
              type="button"
              disabled={drafting || !text.trim()}
              loading={sending}
              onClick={() => void send()}
            >
              Send to Space
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
