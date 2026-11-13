// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { RotateCw, Save, Search, WrapText } from "lucide-react";
import { Button, ChoiceGroup, IconButton, Surface, Text, Tooltip } from "@/shared/ui";
import type { EditorViewMode } from "./editorViewMode";

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
}) {
  return (
    <div className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3 text-meta">
      <Tooltip content={path}>
        <Text tone="default">{name}</Text>
      </Tooltip>
      {dirty ? (
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
      {!readOnly ? (
        <Button variant="secondary" icon={Save} disabled={!dirty || saving} onClick={onSave}>
          Save
        </Button>
      ) : null}
    </div>
  );
}
