// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { FileText, FolderInput, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { folderName, useLinkedFolders } from "../host";
import { DesktopSettingsNotice, DesktopSettingsSection as Section } from "@/features/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SkeletonList,
} from "@/shared/ui";
import { PromptEditorDialog, type PromptEditorValue } from "./PromptEditorDialog";
import { revealPrompts, type CustomPromptEntry, type PromptScope } from "./promptsApi";
import {
  createPrompt,
  deletePrompt,
  matchPrompts,
  movePrompt,
  updatePrompt,
  usePromptStore,
} from "./promptStore";

type ScopeFilter = "all" | PromptScope;

const scopeLabel = (scope: PromptScope) => (scope === "workspace" ? "This folder" : "Everywhere");

/** The folder this window's Space works in, or "" when it has none linked. */
function useCurrentFolder(): string {
  const { folders, picked } = useLinkedFolders();
  return picked && folders.includes(picked) ? picked : (folders[0] ?? "");
}

function PromptRow({
  entry,
  folderAvailable,
  onEdit,
  onMove,
  onDelete,
}: {
  entry: CustomPromptEntry;
  folderAvailable: boolean;
  onEdit: () => void;
  onMove: (scope: PromptScope) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2.5">
      <FileText aria-hidden className="size-4 shrink-0 text-cream-muted" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex min-w-0 items-center gap-2 text-md font-medium text-cream-bright">
          <span className="truncate font-mono">!{entry.name}</span>
          <Badge variant="secondary">{scopeLabel(entry.scope)}</Badge>
        </p>
        {entry.description || entry.argumentHint ? (
          <p className="truncate text-sm text-cream-muted">
            {[entry.description, entry.argumentHint].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
      <IconButton label="Edit" variant="ghost" onClick={onEdit}>
        <Pencil />
      </IconButton>
      {folderAvailable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Move" variant="ghost">
              <FolderInput />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["workspace", "global"] as const).map((scope) => (
              <DropdownMenuCheckboxItem
                key={scope}
                checked={entry.scope === scope}
                onSelect={() => entry.scope !== scope && onMove(scope)}
              >
                {scopeLabel(scope)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <IconButton label="Delete" variant="ghost" onClick={onDelete}>
        <Trash2 />
      </IconButton>
    </div>
  );
}

/**
 * Settings › Tools › Prompts: the prompts the composer's `!` menu offers. Folder prompts belong to
 * the folder this Space works in; global ones show in every chat. The store refreshes itself after
 * each change, so the section never asks it to.
 */
export function PromptsSection() {
  const root = useCurrentFolder();
  const cache = usePromptStore((s) => s.byRoot[root]);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomPromptEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomPromptEntry | null>(null);
  const folderAvailable = Boolean(root);

  useEffect(() => {
    usePromptStore.getState().ensure(root);
  }, [root]);

  const reportFailure = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));

  const entries = useMemo(() => {
    const matched = matchPrompts(cache?.entries ?? [], query);
    return scopeFilter === "all" ? matched : matched.filter((entry) => entry.scope === scopeFilter);
  }, [cache?.entries, query, scopeFilter]);

  const submitEditor = (value: PromptEditorValue) => {
    const target = editing;
    setEditing(null);
    setError(null);
    if (target === "new") {
      void createPrompt(root, value.scope, value).catch(reportFailure);
    } else if (target) {
      void updatePrompt(root, target.path, {
        name: value.name,
        description: value.description ?? "",
        argumentHint: value.argumentHint ?? "",
        content: value.content,
      }).catch(reportFailure);
    }
  };

  const confirmDelete = () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    setError(null);
    void deletePrompt(root, target.path).catch(reportFailure);
  };

  const openFolder = () => {
    setError(null);
    const scope: PromptScope =
      scopeFilter === "global" || !folderAvailable ? "global" : "workspace";
    void revealPrompts(root, scope).catch(reportFailure);
  };

  const filtered = Boolean(query) || scopeFilter !== "all";

  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      <Section
        title="Prompts"
        description={
          folderAvailable
            ? `Type ! in the composer to insert one. Folder prompts are kept in ${folderName(root)}/.misty/prompts.`
            : "Type ! in the composer to insert one. Link a folder to this Space to keep prompts with it."
        }
      >
        <div className="flex flex-wrap items-center gap-2 py-3">
          {folderAvailable ? (
            <Select
              value={scopeFilter}
              onValueChange={(value) =>
                setScopeFilter(value === "workspace" || value === "global" ? value : "all")
              }
            >
              <SelectTrigger aria-label="Scope" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="workspace">This folder</SelectItem>
                <SelectItem value="global">Everywhere</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <SearchField
            size="md"
            containerClassName="min-w-40 flex-1"
            aria-label="Search prompts"
            placeholder="Search prompts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button variant="secondary" onClick={openFolder}>
            <FolderOpen />
            Open folder
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus />
            New prompt
          </Button>
        </div>
        {!cache || cache.status === "loading" ? (
          <SkeletonList label="Prompts" rows={3} lines={2} leading="icon" className="py-2" />
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-cream-muted">
            {filtered ? "No matching prompts" : "No prompts yet"}
          </p>
        ) : (
          <div className="divide-y divide-charcoal-border">
            {entries.map((entry) => (
              <PromptRow
                key={entry.path}
                entry={entry}
                folderAvailable={folderAvailable}
                onEdit={() => setEditing(entry)}
                onMove={(scope) => {
                  setError(null);
                  void movePrompt(root, entry.path, scope).catch(reportFailure);
                }}
                onDelete={() => setDeleting(entry)}
              />
            ))}
          </div>
        )}
      </Section>
      {editing ? (
        <PromptEditorDialog
          initial={editing === "new" ? undefined : editing}
          initialScope={scopeFilter === "global" ? "global" : "workspace"}
          folderAvailable={folderAvailable}
          onSubmit={submitEditor}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete prompt?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              “{deleting?.name}” and its Markdown file will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
