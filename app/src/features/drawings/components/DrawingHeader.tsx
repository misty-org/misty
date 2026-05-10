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
} from "@/shared/ui";
import { AiSurfaceButton } from "@/features/ai-surface/AiPaneHost";
import { Check, Puzzle, Trash2 } from "lucide-react";
import { FaFigma } from "react-icons/fa6";
import { useEffect, useRef, useState } from "react";
import type { DrawingConnectionState, SpaceDrawing } from "../types";

export function DrawingHeader(props: {
  drawing: SpaceDrawing;
  connection: DrawingConnectionState;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenFigma?: () => void;
}) {
  const [title, setTitle] = useState(props.drawing.title);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelTitleSave = useRef(false);

  useEffect(() => setTitle(props.drawing.title), [props.drawing.title]);

  const saveTitle = async () => {
    if (cancelTitleSave.current) {
      cancelTitleSave.current = false;
      return;
    }
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
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold text-cream-muted">Journal -</span>
        <Input
          value={title}
          aria-label="Drawing title"
          className={cn(
            "h-8 max-w-md border-transparent bg-transparent px-2 text-sm font-semibold shadow-none",
            "hover:border-charcoal-border focus-visible:border-charcoal-border",
          )}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              cancelTitleSave.current = true;
              setTitle(props.drawing.title);
              event.currentTarget.blur();
            }
          }}
        />
        {saving ? (
          <span className="text-xs text-cream-muted">Saving…</span>
        ) : error ? (
          <span className="truncate text-xs text-cream-bright" role="alert">
            {error}
          </span>
        ) : (
          <Check size={14} className="text-cream-muted" aria-label="Saved" />
        )}
      </div>

      <ConnectionBadge state={props.connection} />

      <AiSurfaceButton />

      {props.onOpenFigma ? (
        <Button type="button" size="sm" variant="ghost" onClick={props.onOpenFigma}>
          <FaFigma className="size-4" aria-hidden />
          Figma
          <Puzzle className="size-3.5 text-cream-muted" aria-hidden />
        </Button>
      ) : null}

      {props.drawing.can_delete ? (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-cream-muted hover:text-cream-bright"
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
              {error ? (
                <p className="m-0 text-sm text-cream-bright" role="alert">
                  {error}
                </p>
              ) : null}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-charcoal-active text-cream-bright hover:bg-charcoal-active"
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
        connected && "border-status-green/30 text-sage-fg",
        state === "error" && "border-charcoal-active/30 text-cream-bright",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-cream-muted",
          connected && "bg-status-green",
          state === "error" && "bg-charcoal-active",
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
