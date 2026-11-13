// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import {
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  Globe,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuCheckItem,
  OverflowFadeText,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SkeletonControl,
  Text,
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
      <Text bare tone="muted" className="flex shrink-0">
        <FileText aria-hidden />
      </Text>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <Text
          bare
          as="p"
          size="body"
          weight="medium"
          tone="bright"
          className="flex min-w-0 items-center gap-2"
        >
          <OverflowFadeText full>{`!${entry.name}`}</OverflowFadeText>
          <Badge variant="secondary">{scopeLabel(entry.scope)}</Badge>
        </Text>
        {entry.description || entry.argumentHint ? (
          <Text as="p" full tone="muted" className="text-sm">
            {[entry.description, entry.argumentHint].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </div>
      <IconButton label="Edit" onClick={onEdit}>
        <Pencil />
      </IconButton>
      {folderAvailable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Move">
              <FolderInput />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["workspace", "global"] as const).map((scope) => (
              <MenuCheckItem
                key={scope}
                icon={scope === "global" ? Globe : Folder}
                label={scopeLabel(scope)}
                checked={entry.scope === scope}
                closeOnSelect
                onCheckedChange={() => entry.scope !== scope && onMove(scope)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <IconButton label="Delete" onClick={onDelete}>
        <Trash2 />
      </IconButton>
    </div>
  );
}

/**
 * The prompts' first read: rows shaped like PromptRow, the file icon, the name with its scope
 * badge over the description, and Edit, Move and Delete.
 */
function PromptRowsSkeleton() {
  const widths = ["w-32", "w-40", "w-28"];
  return (
    <div role="status" aria-label="Prompts" aria-busy="true" className="divide-y">
      <span className="sr-only">Prompts</span>
      {widths.map((width) => (
        <div key={width} aria-hidden="true" className="flex min-h-14 items-center gap-3 py-2.5">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex h-5.5 min-w-0 items-center gap-2">
              <Skeleton className={cn("h-4", width)} />
              <SkeletonControl kind="badge" />
            </div>
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          </div>
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="icon" />
        </div>
      ))}
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
        <div className="flex min-w-0 items-center gap-2 py-3">
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
                <SelectItem value="all" icon={Layers} label="All" />
                <SelectItem value="workspace" icon={Folder} label="This folder" />
                <SelectItem value="global" icon={Globe} label="Everywhere" />
              </SelectContent>
            </Select>
          ) : null}
          <SearchField
            containerClassName="min-w-40 flex-1"
            aria-label="Search prompts"
            placeholder="Search prompts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button onClick={openFolder}>
            <FolderOpen />
            Open folder
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus />
            New prompt
          </Button>
        </div>
        {/* Only the folder's first read draws placeholders; a refresh keeps the list shown. */}
        {!cache || cache.status === "loading" ? (
          <PromptRowsSkeleton />
        ) : entries.length === 0 ? (
          <Text bare as="p" tone="muted" className="py-6 text-center text-sm">
            {filtered ? "No matching prompts" : "No prompts yet"}
          </Text>
        ) : (
          <div className="divide-y">
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
