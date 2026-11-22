// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronRight, RotateCw, Save, Search, WrapText } from "lucide-react";
import { Fragment } from "react";
import { Button, ChoiceGroup, cn, IconButton, Surface, Text, Tooltip } from "@misty/ui";
import type { EditorAppearance } from "./editorAddons";
import { getFileTreeIconSvg } from "../files/fileIcons";
import { useFilesStore } from "../files/filesStore";
import type { EditorViewMode } from "./editorViewMode";

/** The folders between the tree's root and a file, outermost first; none for a file at the top
 * or outside the root. */
function folderTrail(root: string | null, path: string): string[] {
  if (!root || !path.startsWith(`${root}/`)) return [];
  return path
    .slice(root.length + 1)
    .split("/")
    .slice(0, -1);
}

/** The bar over an open file: its name, whether it has unsaved edits, the edit and preview
 * switch for Markdown and HTML, find in a Markdown preview, word wrap and save. */
export function FileEditorHeader({
  path,
  name,
  dirty,
  readOnly,
  canPreview,
  isMarkdown,
  isHtml,
  viewMode,
  onViewModeChange,
  onReloadPreview,
  saving,
  onSave,
  searchOpen,
  onToggleSearch,
  wordWrap,
  onToggleWordWrap,
  appearance,
}: {
  path: string;
  name: string;
  dirty: boolean;
  readOnly: boolean;
  canPreview: boolean;
  /** The Markdown preview also has a find bar. */
  isMarkdown: boolean;
  /** The HTML preview has a reload. */
  isHtml: boolean;
  viewMode: EditorViewMode;
  onViewModeChange(mode: EditorViewMode): void;
  onReloadPreview(): void;
  saving: boolean;
  onSave(): void;
  searchOpen: boolean;
  onToggleSearch(): void;
  wordWrap: boolean;
  onToggleWordWrap(): void;
  /** On the Code page the tab already names the file and marks unsaved edits, and ⌘S saves: the
   * bar shows where the file sits instead, with no Save button. */
  appearance?: EditorAppearance;
}) {
  const page = appearance === "page";
  const root = useFilesStore((state) => state.root);
  const folders = page ? folderTrail(root, path) : [];
  return (
    <div
      className={cn(
        "flex flex-none items-center gap-2 pr-2 text-meta",
        // On the Code page it is a quiet breadcrumb bar flush with the code under it.
        page ? "h-8 pl-4" : "h-10 border-b pl-3",
      )}
    >
      {page ? (
        // VS Code's breadcrumbs: each folder, a chevron between, then the file with its own
        // icon. In a narrow pane the folders fade first; the file's name stays whole.
        <Tooltip content={path}>
          <nav aria-label="Path" className="flex min-w-0 items-center gap-0.5 text-caption">
            {folders.map((folder, index) => (
              <Fragment key={`${index}:${folder}`}>
                <Text tone="muted" className="min-w-0 flex-[0_1_auto]">
                  {folder}
                </Text>
                <Text bare tone="muted" className="flex flex-none" aria-hidden>
                  <ChevronRight />
                </Text>
              </Fragment>
            ))}
            <span
              className="inline-flex size-4 flex-none items-center justify-center"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(name, false) }}
            />
            <Text bare tone="default" className="flex-none pl-1 whitespace-nowrap">
              {name}
            </Text>
          </nav>
        </Tooltip>
      ) : (
        <Tooltip content={path}>
          <Text tone="default">{name}</Text>
        </Tooltip>
      )}
      {dirty && !page ? (
        <Surface as="span" tone="well" radius="sm" className="flex-none px-1.5 py-px text-micro">
          <Text bare tone="muted">
            Unsaved
          </Text>
        </Surface>
      ) : null}
      {readOnly ? (
        <Text size="caption" tone="muted" className="flex-none">
          Too long to edit; the start is shown
        </Text>
      ) : null}
      <div className="flex-1" />
      {isHtml && viewMode === "preview" ? (
        <IconButton label="Reload preview" onClick={onReloadPreview}>
          <RotateCw />
        </IconButton>
      ) : null}
      {isMarkdown && viewMode === "preview" ? (
        <IconButton label="Find in document" aria-pressed={searchOpen} onClick={onToggleSearch}>
          <Search />
        </IconButton>
      ) : null}
      {canPreview ? (
        <ChoiceGroup<EditorViewMode>
          label="View"
          value={viewMode}
          options={[
            { value: "edit", label: "Edit" },
            { value: "preview", label: "Preview" },
          ]}
          onChange={onViewModeChange}
        />
      ) : null}
      {viewMode === "edit" ? (
        <IconButton label="Word wrap" aria-pressed={wordWrap} onClick={onToggleWordWrap}>
          <WrapText />
        </IconButton>
      ) : null}
      {!readOnly && !page ? (
        <Button variant="secondary" icon={Save} disabled={!dirty || saving} onClick={onSave}>
          Save
        </Button>
      ) : null}
    </div>
  );
}
