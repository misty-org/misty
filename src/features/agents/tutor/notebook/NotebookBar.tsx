import { useEffect, useState } from "react";
import {
  ArrowLeft,
  EllipsisVertical,
  Newspaper,
  RefreshCw,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  Input,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
} from "@/shared/ui";
import { lookForNews, setFollow } from "../notebookFollow";
import { useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";
import "./tutorBar.css";

/**
 * The bar across the top of a notebook, after NotebookLM's: back to Notebooks, the notebook's
 * emoji and name (edited in place), then its settings and its actions, among them following the
 * news on it. New notebooks and deleting one live on the Lab's home, where every notebook is.
 */
export function NotebookBar({
  notebook,
  onBack,
  onCustomize,
  onRebrief,
  onError,
}: {
  notebook: Notebook;
  onBack(): void;
  onCustomize(): void;
  /** Writes the overview again. */
  onRebrief(): void;
  onError(message: string): void;
}) {
  const [title, setTitle] = useState(notebook.title);
  useEffect(() => setTitle(notebook.title), [notebook.title]);
  const rename = () => {
    const next = title.trim();
    if (!next) return setTitle(notebook.title);
    if (next !== notebook.title)
      useTutorStore.getState().updateNotebook(notebook.id, (current) => ({
        ...current,
        title: next,
      }));
  };

  return (
    <header className="tutor-bar">
      <IconButton label="Back to the Lab" onClick={onBack}>
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Notebook settings">
              <Settings2 />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-misty-layer-portal>
            <MenuItem icon={SlidersHorizontal} label="Customize notebook" onSelect={onCustomize} />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Notebook actions">
              <EllipsisVertical />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-misty-layer-portal>
            <MenuItem icon={RotateCcw} label="Write the overview again" onSelect={onRebrief} />
            <MenuSeparator />
            <MenuCheckItem
              icon={Newspaper}
              label="Follow the news"
              checked={Boolean(notebook.follow)}
              onCheckedChange={(next) => {
                setFollow(notebook.id, next ? { query: notebook.title } : undefined);
                if (next) void lookForNews(notebook.id).then((failed) => failed && onError(failed));
              }}
            />
            {notebook.follow && (
              <MenuItem
                icon={RefreshCw}
                label="Look for news now"
                onSelect={() =>
                  void lookForNews(notebook.id).then((failed) => failed && onError(failed))
                }
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
