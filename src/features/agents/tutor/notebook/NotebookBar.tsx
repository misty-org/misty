import { useEffect, useState } from "react";
import {
  ArrowLeft,
  EllipsisVertical,
  MousePointer2,
  Plus,
  RotateCcw,
  Settings2,
  Share2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useSpaceWindowStore, useSpacesDirectory, windowSpace } from "@/features/app-windows";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  Input,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
} from "@/shared/ui";
import { companionAvailable, setCompanionOn, useCompanionOn } from "../cursor/companionOn";
import { shareNotebook } from "../tutorShare";
import { useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";
import "./tutorBar.css";

/** The cursor tutor's switch, for a settings menu. Only Misty for macOS and Windows has it. */
export function CursorMenuItem({ onError }: { onError(message: string): void }) {
  const on = useCompanionOn();
  if (!companionAvailable()) return null;
  return (
    <MenuCheckItem
      icon={MousePointer2}
      label="Cursor tutor"
      checked={on === true}
      disabled={on === undefined}
      onCheckedChange={(next) =>
        void setCompanionOn(next).catch((reason: unknown) => onError(String(reason)))
      }
    />
  );
}

/**
 * The bar across the top of a notebook, after NotebookLM's: back to Tutor, the notebook's emoji
 * and name (edited in place), then a new notebook, its settings and its actions.
 */
export function NotebookBar({
  notebook,
  onBack,
  onCreate,
  onCustomize,
  onRebrief,
  onDelete,
  onError,
}: {
  notebook: Notebook;
  onBack(): void;
  onCreate(): void;
  onCustomize(): void;
  /** Writes the overview again. */
  onRebrief(): void;
  onDelete(): void;
  onError(message: string): void;
}) {
  const [title, setTitle] = useState(notebook.title);
  useEffect(() => setTitle(notebook.title), [notebook.title]);
  // Read again when the window shows another Space.
  useSpaceWindowStore((state) => state.identity);
  const space = useSpacesDirectory((state) => windowSpace(state.spaces));
  const [sharing, setSharing] = useState(false);
  const sharedHere = Boolean(space && notebook.sharedNote?.spaceId === space.id);
  const rename = () => {
    const next = title.trim();
    if (!next) return setTitle(notebook.title);
    if (next !== notebook.title)
      useTutorStore.getState().updateNotebook(notebook.id, (current) => ({
        ...current,
        title: next,
      }));
  };
  const share = () => {
    if (!space) return;
    setSharing(true);
    shareNotebook(notebook.id, space.id)
      .catch((reason: unknown) =>
        onError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setSharing(false));
  };

  return (
    <header className="tutor-bar">
      <IconButton label="Back to Tutor" onClick={onBack}>
        <ArrowLeft />
      </IconButton>
      <span className="tutor-bar-emoji" aria-hidden="true">
        {notebook.emoji ?? "📓"}
      </span>
      <Input
        className="tutor-bar-title"
        aria-label="Notebook name"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={rename}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setTitle(notebook.title);
            event.currentTarget.blur();
          }
        }}
      />
      <div className="tutor-bar-actions">
        <Button className="tutor-bar-create" onClick={onCreate} icon={Plus}>
          Create notebook
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Notebook settings">
              <Settings2 />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-misty-layer-portal>
            <MenuItem icon={SlidersHorizontal} label="Customize notebook" onSelect={onCustomize} />
            {companionAvailable() && <MenuSeparator />}
            <CursorMenuItem onError={onError} />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Notebook actions">
              <EllipsisVertical />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-misty-layer-portal>
            {space && (
              <MenuItem
                icon={Share2}
                label={sharedHere ? `Update in ${space.name}` : `Share to ${space.name}`}
                disabled={sharing}
                onSelect={share}
              />
            )}
            <MenuItem icon={RotateCcw} label="Write the overview again" onSelect={onRebrief} />
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete notebook" danger onSelect={onDelete} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
