import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@/shared/ui";
import { useEffect, useState } from "react";
import type { NewNoteDialogProps } from "../model/interfaces/components/NotesIntegrationsDialog";
export type { NewNoteDialogProps } from "../model/interfaces/components/NotesIntegrationsDialog";
export function NewNoteDialogView(props: NewNoteDialogProps) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!props.open) return;
    setTitle("");
    setSubmitting(false);
  }, [props.open]);
  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await props.onCreate({
        title,
        body: "",
      });
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={cn("max-w-[380px]")}>
        <DialogHeader>
          <DialogTitle className="text-[14px]">New note</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="new-note-title" className="text-[11px]">
            Title
          </Label>
          <Input
            id="new-note-title"
            value={title}
            autoFocus
            placeholder="Untitled note"
            className={cn("h-8 text-[13px]")}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(false)}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn(false)}
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? "Creating…" : "Create note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
