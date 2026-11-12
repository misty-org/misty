// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): CliEngineSettingsCard.tsx.
// See NOTICE.

/**
 * An engine's program in Settings › Channels:
 *   Program path — the program to start instead of the one found on PATH (`binOverrides`). Codex
 *     shows its home folder instead, which also finds `<home>/bin/codex`; DeepSeek Harness keeps
 *     its path beside the host settings.
 *   Codex home — the folder Codex keeps its config and sessions in (`codexHome`).
 *   Custom models — model names offered beside the engine's own in model menus (`customModels`).
 *
 * Native code checks a path before keeping it (an absolute path that resolves, never under a temp
 * folder) and the launch path reads the same settings. Each save is applied to a fresh read.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { useState } from "react";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Skeleton,
  IconButton,
} from "@/shared/ui";
import { notifyCliConfigChanged } from "../channels/providers";
import { ENGINE_NAMES, type EngineId } from "../channels/engines";
import { binKey, useEngineSettings, type EngineSettings } from "./api";

type Save = (change: (settings: EngineSettings) => EngineSettings) => Promise<string | null>;

const pathText = "min-w-0 max-w-[260px] truncate font-mono text-xs text-cream-muted";

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** A path, typed or picked, with Clear when one is set. */
function PathDialog({
  title,
  current,
  directory,
  onSave,
  onClose,
}: {
  title: string;
  current: string | null;
  directory: boolean;
  onSave: (value: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(current ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const commit = async (value: string | null) => {
    setSaving(true);
    const failed = await onSave(value);
    setSaving(false);
    if (failed) setError(failed);
    else onClose();
  };
  const choose = async () => {
    const picked = await open({ directory, multiple: false, title }).catch(() => null);
    if (typeof picked === "string") setDraft(picked);
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent aria-describedby={undefined} className="grid w-[480px] max-w-[94vw] gap-4 p-5">
        <DialogTitle className="pr-10 text-base">{title}</DialogTitle>
        <div className="flex items-center gap-2">
          <Input
            aria-label={title}
            placeholder={directory ? "Default folder" : "Found on PATH"}
            value={draft}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
          />
          <Button variant="secondary" onClick={() => void choose()}>
            Choose
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-cream-muted">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {current ? (
            <Button variant="secondary" disabled={saving} onClick={() => void commit(null)}>
              Clear
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || !draft.trim() || draft.trim() === (current ?? "")}
            onClick={() => void commit(draft.trim())}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgramPathRow({
  engine,
  settings,
  save,
}: {
  engine: EngineId;
  settings: EngineSettings;
  save: Save;
}) {
  const [open, setOpen] = useState(false);
  const key = binKey(engine);
  const current = stringOf(settings.binOverrides?.[key]);
  const title = `${ENGINE_NAMES[engine]} program`;
  return (
    <DesktopSettingsRow label="Program path">
      <span className={pathText} title={current ?? undefined}>
        {current ?? "Found on PATH"}
      </span>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {current ? "Change" : "Set"}
      </Button>
      {open ? (
        <PathDialog
          title={title}
          current={current}
          directory={false}
          onClose={() => setOpen(false)}
          onSave={(value) =>
            save((latest) => {
              const binOverrides = { ...latest.binOverrides };
              if (value) binOverrides[key] = value;
              else delete binOverrides[key];
              return { ...latest, binOverrides };
            }).then((failed) => {
              if (!failed) notifyCliConfigChanged();
              return failed;
            })
          }
        />
      ) : null}
    </DesktopSettingsRow>
  );
}

function CodexHomeRow({ settings, save }: { settings: EngineSettings; save: Save }) {
  const [open, setOpen] = useState(false);
  const current = stringOf(settings.codexHome);
  return (
    <DesktopSettingsRow label="Codex home">
      <span className={pathText} title={current ?? undefined}>
        {current ?? "~/.codex"}
      </span>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {current ? "Change" : "Set"}
      </Button>
      {open ? (
        <PathDialog
          title="Codex home"
          current={current}
          directory
          onClose={() => setOpen(false)}
          onSave={(value) =>
            save((latest) => ({ ...latest, codexHome: value })).then((failed) => {
              if (!failed) notifyCliConfigChanged();
              return failed;
            })
          }
        />
      ) : null}
    </DesktopSettingsRow>
  );
}

function CustomModelsDialog({
  engine,
  models,
  save,
  onClose,
}: {
  engine: EngineId;
  models: string[];
  save: Save;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(models);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const add = () => {
    const id = adding.trim();
    if (!id) return;
    if (draft.includes(id)) {
      setError("That model is already in the list.");
      return;
    }
    setError("");
    setDraft((list) => [...list, id]);
    setAdding("");
  };
  const commit = async () => {
    setSaving(true);
    const failed = await save((latest) => ({
      ...latest,
      customModels: { ...latest.customModels, [engine]: draft },
    }));
    setSaving(false);
    if (failed) {
      setError(failed);
      return;
    }
    // Model menus read the list again on this.
    notifyCliConfigChanged();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent aria-describedby={undefined} className="grid w-[480px] max-w-[94vw] gap-4 p-5">
        <DialogTitle className="pr-10 text-base">{ENGINE_NAMES[engine]} custom models</DialogTitle>
        <div className="grid gap-2">
          {draft.length === 0 ? <p className="text-sm text-cream-muted">No custom models</p> : null}
          {draft.map((model) => (
            <div
              key={model}
              className="flex items-center gap-2 rounded-lg border border-charcoal-border px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-cream">{model}</span>
              <IconButton
                size="xs"
                variant="ghost"
                label={`Remove ${model}`}
                onClick={() => setDraft((list) => list.filter((item) => item !== model))}
              >
                <X />
              </IconButton>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              aria-label="Model name"
              placeholder="Model name"
              value={adding}
              spellCheck={false}
              onChange={(event) => {
                setAdding(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="secondary" disabled={!adding.trim()} onClick={add}>
              Add
            </Button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-cream-muted">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void commit()}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CustomModelsRow({
  engine,
  settings,
  save,
}: {
  engine: EngineId;
  settings: EngineSettings;
  save: Save;
}) {
  const [open, setOpen] = useState(false);
  const models = settings.customModels?.[engine] ?? [];
  return (
    <DesktopSettingsRow label="Custom models">
      {models.length ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-sm bg-charcoal-hover px-1.5 text-2xs text-cream-muted">
          {models.length}
        </span>
      ) : null}
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open ? (
        <CustomModelsDialog
          engine={engine}
          models={models}
          save={save}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </DesktopSettingsRow>
  );
}

/** The engine's program path (or Codex's home) and its custom models. */
export function EngineProgramSection({ engine }: { engine: EngineId }) {
  const { settings, save } = useEngineSettings();
  return (
    <Section title="Program">
      {settings ? (
        <>
          {engine !== "codex" && engine !== "dsh" ? (
            <ProgramPathRow engine={engine} settings={settings} save={save} />
          ) : null}
          {engine === "codex" ? <CodexHomeRow settings={settings} save={save} /> : null}
          <CustomModelsRow engine={engine} settings={settings} save={save} />
        </>
      ) : (
        <div className="grid gap-3 py-3" aria-label="Reading the engine's settings">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      )}
    </Section>
  );
}
