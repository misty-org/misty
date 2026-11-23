// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  OverflowFadeText,
  Separator,
  Text,
  Textarea,
  Tooltip,
  useNotice,
} from "@misty/ui";
import { errorText } from "../project_api";
import {
  createLaunchScriptEntry,
  useLaunchScripts,
  type LaunchScriptEntry,
} from "./launch_scripts";
import { runLaunchScript } from "./run_launch_script";

const noEntries: LaunchScriptEntry[] = [];

const editorRequests = new Set<(folder: string) => void>();

export function requestLaunchScriptEditor(folder: string): void {
  editorRequests.forEach((listener) => listener(folder));
}

function ScriptFields(props: {
  idPrefix: string;
  label: string;
  script: string;
  autoFocus?: boolean;
  onLabel(value: string): void;
  onScript(value: string): void;
}) {
  return (
    <div className="grid gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${props.idPrefix}-label`}>Name</Label>
        <Input
          id={`${props.idPrefix}-label`}
          className="text-ui"
          value={props.label}
          onChange={(event) => props.onLabel(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${props.idPrefix}-script`}>Command</Label>
        <Textarea
          id={`${props.idPrefix}-script`}
          variant="code"
          autoFocus={props.autoFocus}
          rows={4}
          placeholder="npm run dev"
          value={props.script}
          onChange={(event) => props.onScript(event.target.value)}
        />
      </div>
    </div>
  );
}

export function LaunchScriptButton({ chat, folder }: { chat: string; folder: string }) {
  const entries = useLaunchScripts((state) => state.byFolder[folder] ?? noEntries);
  const loaded = useLaunchScripts((state) => state.byFolder[folder] !== undefined);
  const [editIndex, setEditIndex] = useState<number | null | false>(false);
  const [showNew, setShowNew] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftScript, setDraftScript] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newScript, setNewScript] = useState("");
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  useEffect(() => {
    void useLaunchScripts
      .getState()
      .load(folder)
      .catch((reason) => setError(`The start commands couldn't be read: ${errorText(reason)}`));
  }, [folder]);

  const openEditor = useCallback(
    (index: number | null) => {
      const stored = useLaunchScripts.getState().byFolder[folder] ?? [];
      const entry = index === null ? undefined : stored[index];
      setDraftLabel(entry?.label ?? "");
      setDraftScript(entry?.script ?? "");
      setNewLabel("");
      setNewScript("");
      setShowNew(false);
      setError("");
      setEditIndex(index);
    },
    [folder],
  );

  useEffect(() => {
    const listener = (asked: string) => {
      if (asked !== folder) return;
      const stored = useLaunchScripts.getState().byFolder[folder] ?? [];
      openEditor(stored.length ? 0 : null);
    };
    editorRequests.add(listener);
    return () => {
      editorRequests.delete(listener);
    };
  }, [folder, openEditor]);

  const closeEditor = () => {
    setEditIndex(false);
    setShowNew(false);
  };

  const persist = (next: LaunchScriptEntry[]) =>
    useLaunchScripts
      .getState()
      .save(folder, next)
      .then(closeEditor)
      .catch((reason) => setError(errorText(reason)));

  const run = (entry: LaunchScriptEntry, index: number) => {
    setError("");
    void runLaunchScript(chat, folder, entry).catch((reason: unknown) => {
      openEditor(index);
      setError(`The start command could not run: ${errorText(reason)}`);
    });
  };

  const saveEdit = () => {
    if (editIndex === false) return;
    const script = draftScript.trim();
    const next = [...entries];
    if (editIndex === null) {
      if (script) next.push(createLaunchScriptEntry(draftLabel, script));
    } else if (script) {
      next[editIndex] = { ...next[editIndex], label: draftLabel.trim(), script };
    } else {
      next.splice(editIndex, 1);
    }
    void persist(next);
  };

  const createNew = () => {
    if (!newScript.trim()) return;
    void persist([...entries, createLaunchScriptEntry(newLabel, newScript)]);
  };

  if (!loaded) return null;
  const [primary, ...rest] = entries;
  const primaryLabel = primary ? "Run start command" : "Set start command";

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {primary?.label ? (
        <Tooltip content={`${primary.label}: ${primary.script}`}>
          <Button
            type="button"
            variant="quiet"
            icon={Play}
            className="max-w-35"
            onClick={() => run(primary, 0)}
            onContextMenu={(event) => {
              event.preventDefault();
              openEditor(0);
            }}
          >
            <OverflowFadeText>{primary.label}</OverflowFadeText>
          </Button>
        </Tooltip>
      ) : (
        <IconButton
          label={primaryLabel}
          hint={primary ? `${primaryLabel}: ${primary.script}` : undefined}
          onClick={() => (primary ? run(primary, 0) : openEditor(null))}
          onContextMenu={(event) => {
            event.preventDefault();
            openEditor(primary ? 0 : null);
          }}
        >
          <Play />
        </IconButton>
      )}
      {rest.map((entry, index) => (
        <Tooltip key={entry.id} content={entry.script}>
          <Button
            type="button"
            variant="quiet"
            icon={Play}
            className="max-w-35"
            onClick={() => run(entry, index + 1)}
            onContextMenu={(event) => {
              event.preventDefault();
              openEditor(index + 1);
            }}
          >
            <OverflowFadeText>{entry.label || entry.script}</OverflowFadeText>
          </Button>
        </Tooltip>
      ))}
      <Dialog open={editIndex !== false} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent aria-describedby={undefined} className="max-w-105">
          <DialogHeader>
            <DialogTitle className="text-control">Start command</DialogTitle>
          </DialogHeader>
          <ScriptFields
            idPrefix="launch-script"
            autoFocus
            label={draftLabel}
            script={draftScript}
            onLabel={setDraftLabel}
            onScript={setDraftScript}
          />
          {showNew ? (
            <div className="grid gap-3">
              <Separator />
              <Text as="h3" bare size="meta" weight="medium" tone="bright" className="m-0">
                New command
              </Text>
              <ScriptFields
                idPrefix="launch-script-new"
                label={newLabel}
                script={newScript}
                onLabel={setNewLabel}
                onScript={setNewScript}
              />
              <div className="flex justify-end gap-1.5">
                <Button type="button" variant="quiet" onClick={() => setShowNew(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={!newScript.trim()} onClick={createNew}>
                  Add command
                </Button>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="quiet" onClick={closeEditor}>
              Cancel
            </Button>
            {showNew ? null : (
              <Button type="button" variant="quiet" onClick={() => setShowNew(true)}>
                New command
              </Button>
            )}
            <Button type="button" onClick={saveEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
