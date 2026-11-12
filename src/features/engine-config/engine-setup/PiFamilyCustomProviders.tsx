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
  Textarea,
  OverflowFadeText,
} from "@/shared/ui";
import { BrandTile } from "../brands/BrandMark";
import { notifyCliConfigChanged } from "../channels/providers";

import { piFamilyApi, type PiFamilyModelsConfigReadResult } from "./api";
import {
  extractProviderBlock,
  removeProviderBlock,
  replaceProviderBlock,
} from "./piFamilyModelsBlocks";

import { CARD, errorText, ROW, State, type PiEngine } from "./PiFamilyParts";

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
    <p role="alert" className="text-sm text-cream-muted">
      {error}
    </p>
  ) : null;
  const editorActions = (onCancel: () => void, onSave: () => void) => (
    <div className="flex items-center justify-end gap-2">
      <code className="mr-auto min-w-0 truncate text-micro text-cream-muted">
        {config?.file.path}
      </code>
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" disabled={saving} onClick={onSave}>
        {saving ? "Saving" : "Save"}
      </Button>
    </div>
  );

  return (
    <section aria-label="Custom providers" className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-body font-semibold text-cream-bright">Custom providers</h2>
        {draft === null ? (
          <Button disabled={!config} onClick={() => edit()}>
            Edit {file}
          </Button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="grid gap-2">
          <Textarea
            aria-label={file}
            className="min-h-[260px] font-mono text-xs"
            spellCheck={false}
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
          <div className={CARD}>
            {!config ? (
              <SkeletonList lines={2} label="Reading custom providers" rows={2} leading="tile" />
            ) : config.parseError ? (
              <div role="alert" className={cn(ROW, "text-sm text-cream-muted")}>
                {file} can't be read: {config.parseError}
              </div>
            ) : config.providers.length === 0 ? (
              <div className={cn(ROW, "text-sm text-cream-muted")}>No custom providers</div>
            ) : (
              config.providers.map((provider) => (
                <div key={provider.id} className="border-b border-charcoal-border last:border-b-0">
                  <div className={cn(ROW, "border-b-0")}>
                    <BrandTile mark={null} />
                    <div className="grid min-w-0 flex-1">
                      <OverflowFadeText as="p" full className="text-sm text-cream-bright">
                        {provider.name ?? provider.id}
                      </OverflowFadeText>
                      {provider.baseUrl ? (
                        <OverflowFadeText
                          as="p"
                          full
                          className="font-mono text-micro text-cream-muted"
                        >
                          {provider.baseUrl}
                        </OverflowFadeText>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-cream-muted">
                      {provider.modelCount === 1 ? "1 model" : `${provider.modelCount} models`}
                    </span>
                    <State on={provider.hasApiKey} label={provider.hasApiKey ? "Key" : "No key"} />
                    <IconButton
                      label={`Edit ${provider.id}`}
                      size="sm"
                      disabled={saving}
                      aria-pressed={editingId === provider.id}
                      onClick={() => editProvider(provider.id)}
                    >
                      <Pencil aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Remove ${provider.id}`}
                      size="sm"
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
                        aria-label={`${provider.id} in ${file}`}
                        className="min-h-[200px] font-mono text-xs"
                        spellCheck={false}
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
          </div>
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
