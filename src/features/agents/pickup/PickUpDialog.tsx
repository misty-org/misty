import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  Input,
  Label,
  Skeleton,
  Textarea,
} from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { folderName, mistyEngine, useEnginesList } from "../engines/engines_api";
import { useChatFolder } from "../shared-folders/chat_folder";
import { draftPickUp, pickUpMarkdown, pickUpTitle, sendPickUp } from "./pick_up";

export function PickUpDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  spaceId: string;
  solo: boolean;
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
  const engines = useEnginesList();
  const chatFolder = useChatFolder(props.conversationId);
  const project = chatFolder.kind === "project" ? chatFolder.folder : "";

  useEffect(() => {
    if (!props.open) return;
    let live = true;
    setTitle(pickUpTitle(props.chatTitle));
    setText("");
    setError("");
    setDrafting(true);
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
      const engineId = props.agent?.engine ?? "";
      const engine =
        engineId && engineId !== mistyEngine
          ? (engines.data?.find((item) => item.id === engineId)?.name ?? engineId)
          : "";
      const markdown = pickUpMarkdown(text, {
        agentName: props.agent?.name ?? "Agent",
        engine,
        folder: project ? folderName(project) : "",
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
          <DialogTitle className="text-control">Save where it left off</DialogTitle>
          <DialogDescription>
            {props.solo
              ? "Saved as a doc only you can see."
              : "Saved as a doc everyone in the Space can see and pick up."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pick-up-title">Title</Label>
            <Input
              id="pick-up-title"
              value={title}
              className="text-ui"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pick-up-text">Note</Label>
            {drafting && !text ? (
              <Skeleton className="h-75 rounded-lg" />
            ) : (
              <Textarea
                id="pick-up-text"
                value={text}
                rows={14}
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
              disabled={drafting || !text.trim() || sending}
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
