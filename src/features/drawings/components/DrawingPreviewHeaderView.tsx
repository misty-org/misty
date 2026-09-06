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

export function DrawingPreviewHeaderView(props: {
  reportError(input: { title: string; error: unknown; scope: string }): void;
  drawing: SpaceDrawing;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(props.drawing.title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canRename = props.drawing.role !== "viewer";
  const hasActions = canRename || props.drawing.can_delete;

  useEffect(() => {
    setRenaming(false);
    setTitle(props.drawing.title);
  }, [props.drawing.id, props.drawing.title]);

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  const cancelRename = () => {
    setTitle(props.drawing.title);
    setRenaming(false);
  };

  const saveTitle = async () => {
    if (saving) return;
    const nextTitle = title.trim() || "Untitled drawing";
    if (nextTitle === props.drawing.title) {
      setTitle(nextTitle);
      setRenaming(false);
      return;
    }
    setSaving(true);
    try {
      await props.onRename(nextTitle);
      setTitle(nextTitle);
      setRenaming(false);
    } catch (error) {
      props.reportError({
        title: "Drawing title could not be saved",
        error,
        scope: `drawings:${props.drawing.id}:rename`,
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
            {props.drawing.can_delete ? (
              <DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
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
          onClick={props.onOpen}
        >
          Open
          <ArrowRight data-icon="inline-end" className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
