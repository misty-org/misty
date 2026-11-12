// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { RotateCw, Save, Search, WrapText } from "lucide-react";
import { Button, IconButton, SegmentedControl } from "@/shared/ui";
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
    <div className="editor-head">
      <span className="editor-head-name" title={path}>
        {name}
      </span>
      {dirty ? <span className="editor-head-badge">Unsaved</span> : null}
      {readOnly ? (
        <span className="editor-head-note">Too long to edit; the start is shown</span>
      ) : null}
      <div className="flex-1" />
      {isHtml && viewMode === "preview" ? (
        <IconButton label="Reload preview" size="xs" onClick={onReloadPreview}>
          <RotateCw />
        </IconButton>
      ) : null}
      {isMarkdown && viewMode === "preview" ? (
        <IconButton
          label="Find in document"
          size="xs"
          aria-pressed={searchOpen}
          onClick={onToggleSearch}
        >
          <Search />
        </IconButton>
      ) : null}
      {canPreview ? (
        <SegmentedControl<EditorViewMode>
          label="View"
          size="xs"
          value={viewMode}
          options={[
            { value: "edit", label: "Edit" },
            { value: "preview", label: "Preview" },
          ]}
          onChange={onViewModeChange}
        />
      ) : null}
      {viewMode === "edit" ? (
        <IconButton label="Word wrap" size="xs" aria-pressed={wordWrap} onClick={onToggleWordWrap}>
          <WrapText />
        </IconButton>
      ) : null}
      {!readOnly ? (
        <Button size="xs" variant="secondary" disabled={!dirty || saving} onClick={onSave}>
          <Save />
          Save
        </Button>
      ) : null}
    </div>
  );
}
