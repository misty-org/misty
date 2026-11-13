import { BackButton, Button, Input, Surface, Text, useNotice } from "@/shared/ui";
import { useEffect, useState } from "react";
import type { SpaceDrawing } from "../drawingTypes";

interface DrawingHeaderProps {
  reportError?: (input: { title: string; error: unknown; scope: string }) => void;
  drawing: SpaceDrawing;
  onBack?: () => void;
  onRename: (title: string) => Promise<void>;
}

export function DrawingHeader({ reportError, drawing, onBack, onRename }: DrawingHeaderProps) {
  const [title, setTitle] = useState(drawing.title);
  const [savedTitle, setSavedTitle] = useState(drawing.title);
  const [inputActive, setInputActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const titleChanged = title !== savedTitle;
  useNotice(saveFailed, {
    message: "Title not saved. Press Enter in the title to retry.",
    tone: "error",
    onDismiss: () => setSaveFailed(false),
  });

  useEffect(() => {
    setTitle(drawing.title);
    setSavedTitle(drawing.title);
    setSaveFailed(false);
  }, [drawing.id, drawing.title]);

  const saveTitle = async () => {
    if (!titleChanged || saving || drawing.role === "viewer") return;
    const next = title.trim() || "Untitled drawing";
    setTitle(next);
    if (next === savedTitle) {
      setSaveFailed(false);
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    try {
      await onRename(next);
      setSavedTitle(next);
    } catch (cause) {
      setSaveFailed(true);
      reportError?.({
        title: "Drawing title could not be saved",
        error: cause,
        scope: `drawings:${drawing.id}:rename`,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Surface
      as="header"
      tone="page"
      className="flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 pl-1 pr-3"
    >
      {onBack ? (
        <BackButton onClick={onBack} aria-label="Back to drawings" />
      ) : (
        <Text bare tone="muted" className="shrink-0 text-sm font-semibold">
          Docs -
        </Text>
      )}

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-tour="drawing-title"
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
          readOnly={saving || drawing.role === "viewer"}
          className="max-w-md px-2 text-sm font-semibold shadow-none"
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

        {inputActive && drawing.role !== "viewer" ? (
          <Button
            type="button"
            className="shrink-0 text-xs"
            disabled={!titleChanged}
            loading={saving}
            aria-label="Save drawing title"
            onClick={() => void saveTitle()}
          >
            Save
          </Button>
        ) : null}
      </div>
    </Surface>
  );
}
