import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@/shared/ui";
import { useEffect, useState } from "react";

export function NewDrawingDialogView(props: {
  reportError(input: { title: string; error: unknown; scope: string }): void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setTitle("");
    setSubmitting(false);
  }, [props.open]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await props.onCreate(title);
      props.onOpenChange(false);
    } catch (cause) {
      props.reportError({
        error: cause,
        scope: "drawings:create",
        title: "Drawing could not be created",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-[14px]">New drawing</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="new-drawing-title" className="text-[11px]">
            Title
          </Label>
          <Input
            id="new-drawing-title"
            value={title}
            autoFocus
            placeholder="Untitled drawing"
            className="h-8 text-[13px]"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Creating…" : "Create drawing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
