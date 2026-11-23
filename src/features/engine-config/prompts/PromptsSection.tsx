// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { FileText, Folder, FolderOpen, Globe, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { folderName, useLinkedFolders } from "../host";
import {
  Button,
  CollectionControls,
  ConfirmDeleteDialog,
  EmptyState,
  ErrorState,
  MenuItem,
  MenuSeparator,
  notify,
  PersonaLogo,
  PropertyList,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  StoreDetail,
  StoreDetailSection,
  Text,
} from "@misty/ui";
import { PromptEditorDialog, type PromptEditorValue } from "./PromptEditorDialog";
import { revealPrompts, type CustomPromptEntry, type PromptScope } from "./prompts_api";
import {
  createPrompt,
  deletePrompt,
  matchPrompts,
  movePrompt,
  updatePrompt,
  usePromptStore,
} from "./prompt_store";

const NO_PROMPTS: CustomPromptEntry[] = [];

const scopeLabel = (scope: PromptScope) => (scope === "workspace" ? "This folder" : "Everywhere");

const failureText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const reportFailure = (cause: unknown) => notify({ message: failureText(cause), tone: "error" });

function useCurrentFolder(): string {
  const { folders, picked } = useLinkedFolders();
  return picked && folders.includes(picked) ? picked : (folders[0] ?? "");
}

function PromptLogo(_props: { entry: CustomPromptEntry }) {
  return <PersonaLogo icon={FileText} size="tile" />;
}

const promptLine = (entry: CustomPromptEntry) =>
  entry.description || entry.argumentHint || scopeLabel(entry.scope);

function PromptMenu({
  entry,
  folderAvailable,
  onOpen,
  onEdit,
  onMove,
  onReveal,
  onDelete,
}: {
  entry: CustomPromptEntry;
  folderAvailable: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onMove: (scope: PromptScope) => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const other: PromptScope = entry.scope === "workspace" ? "global" : "workspace";
  return (
    <>
      <MenuItem icon={Info} label="Details" onSelect={onOpen} />
      <MenuItem icon={Pencil} label="Edit" onSelect={onEdit} />
      {folderAvailable ? (
        <MenuItem
          icon={other === "global" ? Globe : Folder}
          label={other === "global" ? "Move to everywhere" : "Move to this folder"}
          onSelect={() => onMove(other)}
        />
      ) : null}
      <MenuItem icon={FolderOpen} label="Open folder" onSelect={onReveal} />
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete" danger onSelect={onDelete} />
    </>
  );
}

export function PromptsSection({ query = "" }: { query?: string } = {}) {
  const root = useCurrentFolder();
  const cache = usePromptStore((s) => s.byRoot[root]);
  const [editing, setEditing] = useState<CustomPromptEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomPromptEntry | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const folderAvailable = Boolean(root);

  useEffect(() => {
    usePromptStore.getState().ensure(root);
  }, [root]);

  const all = cache?.entries ?? NO_PROMPTS;
  const entries = useMemo(() => matchPrompts(all, query), [all, query]);
  const folderPrompts = entries.filter((entry) => entry.scope === "workspace");
  const globalPrompts = entries.filter((entry) => entry.scope === "global");
  const open = all.find((entry) => entry.path === openPath) ?? null;

  const submitEditor = (value: PromptEditorValue) => {
    const target = editing;
    setEditing(null);
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

  const reveal = (scope: PromptScope) =>
    void revealPrompts(root, folderAvailable ? scope : "global").catch(reportFailure);
  const move = (entry: CustomPromptEntry, scope: PromptScope) =>
    void movePrompt(root, entry.path, scope).catch(reportFailure);

  const firstLoad = !cache || cache.status === "loading";
  const failed = cache?.status === "error" && all.length === 0;
  const empty = !firstLoad && !failed && all.length === 0;

  const shelf = (title: string, items: CustomPromptEntry[]) =>
    items.length ? (
      <Shelf title={title}>
        {items.map((entry) => (
          <ShelfItem
            key={entry.path}
            logo={<PromptLogo entry={entry} />}
            title={`!${entry.name}`}
            line={promptLine(entry)}
            action={
              <Button size="sm" onClick={() => setEditing(entry)}>
                Edit
              </Button>
            }
            menu={
              <PromptMenu
                entry={entry}
                folderAvailable={folderAvailable}
                onOpen={() => setOpenPath(entry.path)}
                onEdit={() => setEditing(entry)}
                onMove={(scope) => move(entry, scope)}
                onReveal={() => reveal(entry.scope)}
                onDelete={() => setDeleting(entry)}
              />
            }
            onOpen={() => setOpenPath(entry.path)}
          />
        ))}
      </Shelf>
    ) : null;

  const body = () => {
    if (firstLoad) {
      return (
        <>
          {folderAvailable ? <ShelfSkeleton label={`In ${folderName(root)}`} /> : null}
          <ShelfSkeleton label="Everywhere" />
        </>
      );
    }
    if (failed) {
      return (
        <ErrorState
          inline
          title="Prompts couldn't load"
          line="Misty couldn't read the prompts folder."
          action={{
            label: "Try again",
            variant: "secondary",
            onClick: () => void usePromptStore.getState().refresh(root),
          }}
        />
      );
    }
    if (empty) {
      return (
        <EmptyState
          inline
          title="No prompts yet"
          line="Type ! in the composer to insert one."
          action={{ label: "New prompt", icon: Plus, onClick: () => setEditing("new") }}
        />
      );
    }
    if (entries.length === 0) {
      return <EmptyState inline title="No prompts found" line="Try another word." />;
    }
    return (
      <>
        {shelf(`In ${folderName(root)}`, folderPrompts)}
        {shelf("Everywhere", globalPrompts)}
      </>
    );
  };

  return (
    <>
      <CollectionControls
        actions={
          <div className="flex items-center gap-1">
            <Button icon={FolderOpen} onClick={() => reveal("workspace")}>
              Open folder
            </Button>
            {empty ? null : (
              <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
                New prompt
              </Button>
            )}
          </div>
        }
      />
      {body()}
      {open ? (
        <StoreDetail
          open
          onOpenChange={(next) => !next && setOpenPath(null)}
          logo={<PromptLogo entry={open} />}
          title={`!${open.name}`}
          line={open.description || undefined}
          action={
            <Button variant="primary" size="lg" icon={Pencil} onClick={() => setEditing(open)}>
              Edit
            </Button>
          }
          facts={[
            { label: "Scope", value: scopeLabel(open.scope) },
            { label: "Argument", value: open.argumentHint || "None" },
            { label: "Length", value: String(open.content.split("\n").length), detail: "Lines" },
          ]}
        >
          <StoreDetailSection title="Prompt">
            <Text as="p" tone="default" wrap className="m-0 whitespace-pre-wrap">
              {open.content}
            </Text>
          </StoreDetailSection>
          <StoreDetailSection title="File">
            <PropertyList label="File" items={[{ label: "Path", value: open.path }]} />
          </StoreDetailSection>
        </StoreDetail>
      ) : null}
      {editing ? (
        <PromptEditorDialog
          initial={editing === "new" ? undefined : editing}
          initialScope="workspace"
          folderAvailable={folderAvailable}
          onSubmit={submitEditor}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete "!${deleting?.name ?? ""}"?`}
        what="The prompt and its Markdown file are deleted. This can't be undone."
        onConfirm={async () => {
          if (!deleting) return;
          const path = deleting.path;
          await deletePrompt(root, path);
          if (openPath === path) setOpenPath(null);
        }}
      />
    </>
  );
}
