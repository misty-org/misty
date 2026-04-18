import { Check, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Input,
  cn,
} from "@/ui";
import type { DrawingConnectionState, SpaceDrawing } from "../types";

export function DrawingHeader(props: {
  drawing: SpaceDrawing;
  connection: DrawingConnectionState;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(props.drawing.title);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTitle(props.drawing.title), [props.drawing.title]);

  const saveTitle = async () => {
    const next = title.trim() || "Untitled drawing";
    setTitle(next);
    if (next === props.drawing.title || saving) return;
    setSaving(true);
    setError(null);
    try {
      await props.onRename(next);
    } catch (cause) {
      setTitle(props.drawing.title);
      setError(errorMessage(cause, "Could not rename this drawing."));
    } finally {
      setSaving(false);
    }
  };

  const deleteDrawing = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await props.onDelete();
      setDeleteOpen(false);
    } catch (cause) {
      setError(errorMessage(cause, "Could not delete this drawing."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-background px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Input
          value={title}
          aria-label="Drawing title"
          className="h-8 max-w-md border-transparent bg-transparent px-2 font-medium shadow-none hover:border-input focus-visible:border-input"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setTitle(props.drawing.title);
              event.currentTarget.blur();
            }
          }}
        />
        {saving ? (
          <span className="text-xs text-muted-foreground">Saving…</span>
        ) : error ? (
          <span className="truncate text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : (
          <Check size={14} className="text-muted-foreground" aria-label="Saved" />
        )}
      </div>

      <ConnectionBadge state={props.connection} />

      {props.drawing.can_delete ? (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground hover:text-destructive"
              title="Delete drawing"
              aria-label="Delete drawing"
            >
              <Trash2 size={15} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this drawing?</AlertDialogTitle>
              <AlertDialogDescription>
                “{props.drawing.title}” and its collaborative history will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleting}
                onClick={(event) => {
                  event.preventDefault();
                  void deleteDrawing();
                }}
              >
                {deleting ? "Deleting…" : "Delete drawing"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </header>
  );
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function ConnectionBadge({ state }: { state: DrawingConnectionState }) {
  const connected = state === "connected";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal",
        connected && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
        state === "error" && "border-destructive/30 text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-muted-foreground",
          connected && "bg-emerald-500",
          state === "error" && "bg-destructive",
        )}
      />
      {state === "connected"
        ? "Live"
        : state === "connecting"
          ? "Connecting"
          : state === "disconnected"
            ? "Reconnecting"
            : "Connection issue"}
    </Badge>
  );
}
