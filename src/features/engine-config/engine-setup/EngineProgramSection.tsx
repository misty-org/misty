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
import {
  DesktopSettingsRow,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  IconButton,
  Surface,
  Text,
} from "@/shared/ui";
import { notifyCliConfigChanged } from "../channels/providers";
import { ENGINE_NAMES, type EngineId } from "../channels/engines";
import { binKey, useEngineSettings, type EngineSettings } from "./api";

type Save = (change: (settings: EngineSettings) => EngineSettings) => Promise<string | null>;

const pathText = "min-w-0 max-w-65 text-xs";

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
      <DialogContent aria-describedby={undefined} className="grid w-120 max-w-[94vw] gap-4 p-5">
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
          <Button onClick={() => void choose()}>Choose</Button>
        </div>
        {error ? (
          <Text role="alert" tone="muted" wrap className="text-sm">
            {error}
          </Text>
        ) : null}
        <div className="flex justify-end gap-2">
          {current ? (
            <Button disabled={saving} onClick={() => void commit(null)}>
              Clear
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
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
      <Text full tone="muted" className={pathText}>
        {current ?? "Found on PATH"}
      </Text>
      <Button onClick={() => setOpen(true)}>{current ? "Change" : "Set"}</Button>
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
      <Text full tone="muted" className={pathText}>
        {current ?? "~/.codex"}
      </Text>
      <Button onClick={() => setOpen(true)}>{current ? "Change" : "Set"}</Button>
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
      <DialogContent aria-describedby={undefined} className="grid w-120 max-w-[94vw] gap-4 p-5">
        <DialogTitle className="pr-10 text-base">{ENGINE_NAMES[engine]} custom models</DialogTitle>
        <div className="grid gap-2">
          {draft.length === 0 ? (
            <Text as="p" tone="muted" className="text-sm">
              No custom models
            </Text>
          ) : null}
          {draft.map((model) => (
            <Surface
              key={model}
              tone="none"
              edge="hairline"
              radius="lg"
              className="flex items-center gap-2 px-3 py-1.5"
            >
              <Text full tone="default" className="min-w-0 flex-1 text-xs">
                {model}
              </Text>
              <IconButton
                size="sm"
                label={`Remove ${model}`}
                onClick={() => setDraft((list) => list.filter((item) => item !== model))}
              >
                <X />
              </IconButton>
            </Surface>
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
            <Button disabled={!adding.trim()} onClick={add}>
              Add
            </Button>
          </div>
        </div>
        {error ? (
          <Text role="alert" tone="muted" wrap className="text-sm">
            {error}
          </Text>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
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
      {models.length ? <Badge variant="secondary">{models.length}</Badge> : null}
      <Button onClick={() => setOpen(true)}>Edit</Button>
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
        // The rows it stands for: the program path (or Codex home) and custom models, each ending
        // in its button. DeepSeek Harness keeps its path beside the host, so it has one row.
        <DesktopSettingsRowSkeleton
          label="Reading the engine's settings"
          rows={engine === "dsh" ? 1 : 2}
          control="button"
        />
      )}
    </Section>
  );
}
