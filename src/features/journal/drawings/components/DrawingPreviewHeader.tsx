import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@/shared/ui";
import { ArrowRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SpaceDrawing } from "../types";

export interface DrawingPreviewHeaderProps {
  reportError?: (input: { title: string; error: unknown; scope: string }) => void;
  drawing: SpaceDrawing;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
  onOpen: () => void;
}

export function DrawingPreviewHeader({
  reportError,
  drawing,
  onRename,
  onDelete,
  onOpen,
}: DrawingPreviewHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(drawing.title);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canRename = drawing.role !== "viewer";
  const hasActions = canRename || drawing.can_delete;

  useEffect(() => {
    setRenaming(false);
    setTitle(drawing.title);
  }, [drawing.id, drawing.title]);

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  const cancelRename = () => {
    setTitle(drawing.title);
    setRenaming(false);
  };

  const saveTitle = async () => {
    if (saving) return;
    const nextTitle = title.trim() || "Untitled drawing";
    if (nextTitle === drawing.title) {
      setTitle(nextTitle);
      setRenaming(false);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await onRename(nextTitle);
      setTitle(nextTitle);
      setRenaming(false);
    } catch (error) {
      setFailed(true);
      reportError?.({
        title: "Drawing title could not be saved",
        error,
        scope: `drawings:${drawing.id}:rename`,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-2 flex h-8 shrink-0 items-center gap-2">
      {renaming ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void saveTitle();
          }}
        >
          <Input
            ref={inputRef}
            value={title}
            className="h-8 min-w-0 flex-1 border-charcoal-active bg-charcoal-card px-2 text-sm font-semibold shadow-none"
            aria-label="Drawing title"
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
          <Button type="submit" size="sm" className="h-8 shrink-0 px-3 text-xs" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 shrink-0 px-2 text-xs text-cream-muted"
            disabled={saving}
            onClick={cancelRename}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">
          {title || "Untitled drawing"}
        </h2>
      )}

      {failed && renaming ? (
        <span role="alert" className="text-xs text-cream-muted">
          Not saved. Try Save again.
        </span>
      ) : null}
      {!renaming && hasActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 text-cream-muted hover:text-cream-bright"
              aria-label={`Actions for ${title || "untitled drawing"}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {canRename ? (
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
            ) : null}
            {drawing.can_delete ? (
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {!renaming ? (
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
          aria-label={`Open ${title || "Untitled drawing"}`}
          onClick={onOpen}
        >
          Open
          <ArrowRight data-icon="inline-end" className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

/** @deprecated Use DrawingPreviewHeader directly */
export const DrawingPreviewHeaderView = DrawingPreviewHeader;
