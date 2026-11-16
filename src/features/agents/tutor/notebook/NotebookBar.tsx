import { useEffect, useState, type ReactNode } from "react";
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
  Surface,
  Text,
} from "@/shared/ui";
import { lookForNews, setFollow } from "../notebookFollow";
import { useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";

/**
 * The bar across the top of a notebook, after NotebookLM's: back to Notebooks, the notebook's
 * emoji and name (edited in place), then who else is in it and what they did last, its
 * discussion, its settings and its actions, among them following the news on it (found by the
 * default engine). New notebooks and deleting one live on the Lab's home, where every notebook is.
 */
export function NotebookBar({
  notebook,
  onBack,
  onCustomize,
  onRebrief,
  onError,
  people,
}: {
  notebook: Notebook;
  /** Who else is in the notebook, its last activity and its discussion (NotebookPeople). */
  people?: ReactNode;
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
    <Surface
      as="header"
      tone="none"
      edge="hairline"
      className="flex min-h-13 flex-none items-center gap-1.5 border-0 border-b px-3 py-2"
    >
      <IconButton label="Back to the Lab" onClick={onBack}>
        <ArrowLeft />
      </IconButton>
      <Text bare size="title" className="leading-none" aria-hidden="true">
        {notebook.emoji ?? "📓"}
      </Text>
      <Input
        variant="title"
        className="mx-0 w-auto max-w-140 flex-1 px-1.5 text-title font-medium"
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
      <div className="ml-auto flex items-center gap-1" data-tour="notebook-share">
        {people}
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
            {/* The default engine finds the news with its own web search. */}
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
    </Surface>
  );
}
