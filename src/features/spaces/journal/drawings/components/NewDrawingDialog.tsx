import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useNotice,
} from "@/shared/ui";
import { useEffect, useState } from "react";

interface NewDrawingDialogProps {
  reportError?: (input: { title: string; error: unknown; scope: string }) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => Promise<void>;
}

export function NewDrawingDialog({
  reportError,
  open,
  onOpenChange,
  onCreate,
}: NewDrawingDialogProps) {
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useNotice(failed, {
    message: "Drawing could not be created. Your title is saved here; try Create drawing again.",
    tone: "error",
    onDismiss: () => setFailed(false),
  });

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setFailed(false);
    setSubmitting(false);
  }, [open]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      await onCreate(title);
      onOpenChange(false);
    } catch (cause) {
      setFailed(true);
      reportError?.({
        error: cause,
        scope: "drawings:create",
        title: "Drawing could not be created",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-sm">New drawing</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="new-drawing-title" className="text-2xs">
            Title
          </Label>
          <Input
            id="new-drawing-title"
            value={title}
            autoFocus
            placeholder="Untitled drawing"
            className="h-8 text-ui"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="quiet" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Creating…" : "Create drawing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
