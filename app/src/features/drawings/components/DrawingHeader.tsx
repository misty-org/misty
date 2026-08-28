import { reportSystemError } from "@/features/activity";
import { Button, Input, cn } from "@/shared/ui";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { SpaceDrawing } from "../types";

export function DrawingHeader(props: {
  drawing: SpaceDrawing;
  onBack?: () => void;
  onRename: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.drawing.title);
  const [savedTitle, setSavedTitle] = useState(props.drawing.title);
  const [inputActive, setInputActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const titleChanged = title !== savedTitle;

  useEffect(() => {
    setTitle(props.drawing.title);
    setSavedTitle(props.drawing.title);
    setSaveFailed(false);
  }, [props.drawing.id, props.drawing.title]);

  const saveTitle = async () => {
    if (!titleChanged || saving) return;
    const next = title.trim() || "Untitled drawing";
    setTitle(next);
    if (next === savedTitle) {
      setSaveFailed(false);
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    try {
      await props.onRename(next);
      setSavedTitle(next);
    } catch (cause) {
      setSaveFailed(true);
      reportSystemError({
        title: "Drawing title could not be saved",
        error: cause,
        scope: `drawings:${props.drawing.id}:rename`,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg py-1.5 pl-1 pr-3">
      {props.onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2 text-cream-muted hover:text-cream-bright"
          onClick={props.onBack}
          aria-label="Back to drawings"
        >
          <ChevronLeft size={16} />
          <span className="text-xs font-medium">Drawings</span>
        </Button>
      ) : (
        <span className="shrink-0 text-sm font-semibold text-cream-muted">Journal -</span>
      )}

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        onFocusCapture={() => setInputActive(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setInputActive(false);
          }
        }}
      >
        <Input
          value={title}
          aria-label="Drawing title"
          aria-invalid={saveFailed || undefined}
          aria-busy={saving || undefined}
          readOnly={saving}
          className={cn(
            "h-8 max-w-md border-charcoal-active bg-charcoal-card px-2 text-sm font-semibold shadow-none",
            "focus-visible:border-sage-fg/70 focus-visible:ring-2 focus-visible:ring-sage-fg/15",
          )}
          onChange={(event) => {
            setTitle(event.target.value);
            setSaveFailed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveTitle();
            }
          }}
        />

        {inputActive ? (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3 text-xs"
            disabled={!titleChanged || saving}
            aria-label="Save drawing title"
            onClick={() => void saveTitle()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
