import type { NewNoteDialogProps } from "@/models/interfaces/features/notes/components/NotesIntegrationsDialog";
export type { NewNoteDialogProps } from "@/models/interfaces/features/notes/components/NotesIntegrationsDialog";
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/ui";

const UNLINKED_VALUE = "__unlinked__";

export function NewNoteDialog(props: NewNoteDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [spaceId, setSpaceId] = useState(UNLINKED_VALUE);

  useEffect(() => {
    if (!props.open) return;
    setTitle("");
    setBody("");
    setSpaceId(props.spaces[0]?.id ?? UNLINKED_VALUE);
  }, [props.open, props.spaces]);

  function submit() {
    const space = props.spaces.find((candidate) => candidate.id === spaceId);
    props.onCreate({ title, body, spaceId: space?.id, spaceName: space?.name });
    props.onOpenChange(false);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="text-[14px]">New Misty note</DialogTitle>
          <DialogDescription className="text-[12px]">
            Misty notes are saved privately on this desktop. Assign a Space now, or file it later
            from Unlinked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="new-note-title" className="text-[11px]">
              Title
            </Label>
            <Input
              id="new-note-title"
              value={title}
              autoFocus
              placeholder="Untitled note"
              className="h-8 text-[13px]"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-note-space" className="text-[11px]">
              Space
            </Label>
            <Select value={spaceId} onValueChange={setSpaceId}>
              <SelectTrigger id="new-note-space" className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNLINKED_VALUE}>Unlinked</SelectItem>
                {props.spaces.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {space.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-note-body" className="text-[11px]">
              Body
            </Label>
            <Textarea
              id="new-note-body"
              value={body}
              placeholder="Markdown supported"
              className="min-h-[180px] resize-none font-mono text-[12.5px] leading-[1.65]"
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={submit}>
            Create note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
