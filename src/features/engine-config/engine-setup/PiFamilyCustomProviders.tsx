// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): PiFamilyAuthSection.tsx,
// PiFamilyOauthSection.tsx, PiFamilyApiKeySection.tsx and PiFamilyCustomSection.tsx.
// See NOTICE.
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  IconButton,
  SkeletonList,
  Text,
  Textarea,
} from "@/shared/ui";
import { BrandTile } from "../brands/BrandMark";
import { notifyCliConfigChanged } from "../channels/providers";

import { piFamilyApi, type PiFamilyModelsConfigReadResult } from "./api";
import {
  extractProviderBlock,
  removeProviderBlock,
  replaceProviderBlock,
} from "./piFamilyModelsBlocks";

import { errorText, ROW, RowsCard, State, type PiEngine } from "./PiFamilyParts";

// ── Custom providers ────────────────────────────────────────────────────────

type ProviderSummary = PiFamilyModelsConfigReadResult["providers"][number];

/** The whole file in one editor, or one provider's block of it at a time (ccgui's per-provider
 *  editor): a block edit is spliced back into the file's own text, so comments, key order and
 *  the other providers stay as they were, and the whole file still gets the loose check. */
export function CustomProviders({
  engine,
  config,
  onChanged,
}: {
  engine: PiEngine;
  config: PiFamilyModelsConfigReadResult | null;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [blockDraft, setBlockDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProviderSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = engine === "pi" ? "models.json" : "models.yml";
  const format = config?.file.format ?? (engine === "pi" ? "json" : "yaml");

  const write = async (text: string) => {
    await piFamilyApi.writeModels(engine, text);
    notifyCliConfigChanged();
    await onChanged();
  };
  const closeBlock = () => {
    setEditingId(null);
    setBlockDraft("");
  };
  const edit = (problem: string | null = null) => {
    closeBlock();
    setError(problem);
    const text = config?.text ?? "";
    setDraft(text.trim() ? text : (config?.template ?? ""));
  };
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      await write(draft);
      setDraft(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  const editProvider = (id: string) => {
    if (editingId === id) {
      closeBlock();
      return;
    }
    const block = extractProviderBlock(config?.text ?? "", format, id);
    // A provider the block reader can't find (an unusual layout) opens the whole file instead.
    if (!block) {
      edit(`${id} couldn't be found on its own in ${file}; edit it in the whole file.`);
      return;
    }
    setDraft(null);
    setError(null);
    setEditingId(id);
    setBlockDraft(block.text);
  };
  const saveProvider = async () => {
    const text = config?.text;
    if (!editingId || !text) return;
    setSaving(true);
    setError(null);
    try {
      const block = extractProviderBlock(text, format, editingId);
      if (!block) {
        setError(`${editingId} is no longer in ${file}.`);
        return;
      }
      const next = replaceProviderBlock(text, block, blockDraft);
      if (!extractProviderBlock(next, format, editingId)) {
        setError(`Keep the provider's own key, ${editingId}, at the start of the block.`);
        return;
      }
      await write(next);
      closeBlock();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  const removeProvider = async () => {
    const target = deleteTarget;
    const text = config?.text;
    setDeleteTarget(null);
    if (!target || !text) return;
    setSaving(true);
    setError(null);
    try {
      const block = extractProviderBlock(text, format, target.id);
      if (!block) {
        setError(
          `${target.id} couldn't be found on its own in ${file}; remove it in the whole file.`,
        );
        return;
      }
      await write(removeProviderBlock(text, block, format));
      if (editingId === target.id) closeBlock();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  const errorLine = error ? (
    <Text role="alert" tone="muted" wrap className="text-sm">
      {error}
    </Text>
  ) : null;
  const editorActions = (onCancel: () => void, onSave: () => void) => (
    <div className="flex items-center justify-end gap-2">
      <Text bare as="code" tone="muted" className="mr-auto min-w-0 text-micro">
        <Text full>{config?.file.path}</Text>
      </Text>
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" disabled={saving} onClick={onSave}>
        {saving ? "Saving" : "Save"}
      </Button>
    </div>
  );

  return (
    <section aria-label="Custom providers" className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Text bare as="h2" size="body" weight="semibold" tone="bright">
          Custom providers
        </Text>
        {draft === null ? (
          <Button disabled={!config} onClick={() => edit()}>
            Edit {file}
          </Button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="grid gap-2">
          <Textarea
            variant="code"
            aria-label={file}
            className="min-h-65"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {errorLine}
          {editorActions(
            () => {
              setDraft(null);
              setError(null);
            },
            () => void save(),
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          <RowsCard>
            {!config ? (
              // Most people have none or one, so one row: its tile, name and address, the model
              // count, and Edit and Remove.
              <SkeletonList
                variant="card"
                label="Reading custom providers"
                rows={1}
                lines={2}
                leading="tile"
                trailing={["text", "icon", "icon"]}
              />
            ) : config.parseError ? (
              <Text bare as="div" role="alert" tone="muted" className={cn(ROW, "text-sm")}>
                {file} can't be read: {config.parseError}
              </Text>
            ) : config.providers.length === 0 ? (
              <Text bare as="div" tone="muted" className={cn(ROW, "text-sm")}>
                No custom providers
              </Text>
            ) : (
              config.providers.map((provider) => (
                <div key={provider.id} className="border-b last:border-b-0">
                  <div className={cn(ROW, "border-b-0")}>
                    <BrandTile mark={null} />
                    <div className="grid min-w-0 flex-1">
                      <Text as="p" full tone="bright" className="text-sm">
                        {provider.name ?? provider.id}
                      </Text>
                      {provider.baseUrl ? (
                        <Text as="p" full tone="muted" className="text-micro">
                          {provider.baseUrl}
                        </Text>
                      ) : null}
                    </div>
                    <Text bare tone="muted" className="shrink-0 text-xs">
                      {provider.modelCount === 1 ? "1 model" : `${provider.modelCount} models`}
                    </Text>
                    <State on={provider.hasApiKey} label={provider.hasApiKey ? "Key" : "No key"} />
                    <IconButton
                      label={`Edit ${provider.id}`}
                      disabled={saving}
                      aria-pressed={editingId === provider.id}
                      onClick={() => editProvider(provider.id)}
                    >
                      <Pencil aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Remove ${provider.id}`}
                      disabled={saving}
                      onClick={() => setDeleteTarget(provider)}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </div>
                  {editingId === provider.id ? (
                    <div className="grid gap-2 px-3 pb-3">
                      <Textarea
                        autoFocus
                        variant="code"
                        aria-label={`${provider.id} in ${file}`}
                        className="min-h-50"
                        value={blockDraft}
                        onChange={(event) => setBlockDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") closeBlock();
                        }}
                      />
                      {editorActions(closeBlock, () => void saveProvider())}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </RowsCard>
          {errorLine}
        </div>
      )}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => (open ? undefined : setDeleteTarget(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {deleteTarget?.name ?? deleteTarget?.id} from {file}?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeProvider()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
