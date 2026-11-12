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
  ErrorNotification,
  IconButton,
  Input,
  Label,
  Textarea,
} from "@/shared/ui";
import { errorText } from "../projectApi";
import { createLaunchScriptEntry, useLaunchScripts, type LaunchScriptEntry } from "./launchScripts";
import { runLaunchScript } from "./runLaunchScript";
import "./launchScript.css";

const noEntries: LaunchScriptEntry[] = [];

// Other menus (a folder's menu, the command palette) can ask the mounted button to open its editor.
const editorRequests = new Set<(folder: string) => void>();

/** Opens the start command editor of the folder's mounted launch button. */
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
    <div className="launch-script-fields">
      <div className="space-y-1.5">
        <Label htmlFor={`${props.idPrefix}-label`} className="text-2xs">
          Name
        </Label>
        <Input
          id={`${props.idPrefix}-label`}
          className="h-8 text-ui"
          value={props.label}
          onChange={(event) => props.onLabel(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${props.idPrefix}-script`} className="text-2xs">
          Command
        </Label>
        <Textarea
          id={`${props.idPrefix}-script`}
          className="launch-script-command"
          autoFocus={props.autoFocus}
          rows={4}
          spellCheck={false}
          placeholder="npm run dev"
          value={props.script}
          onChange={(event) => props.onScript(event.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * The folder's start commands in the panel's head, after ccgui's launch script button: the first
 * command gets a play button (click to run it, right-click to edit it), commands with names get
 * named buttons, and the editor changes the first command and adds more. A command runs in the
 * folder's launch tab of the terminal, the same tab every time. Saving an empty command removes it.
 */
export function LaunchScriptButton({ folder }: { folder: string }) {
  const entries = useLaunchScripts((state) => state.byFolder[folder] ?? noEntries);
  const loaded = useLaunchScripts((state) => state.byFolder[folder] !== undefined);
  // `false` while closed; `null` edits a first command that doesn't exist yet.
  const [editIndex, setEditIndex] = useState<number | null | false>(false);
  const [showNew, setShowNew] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftScript, setDraftScript] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newScript, setNewScript] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void useLaunchScripts
      .getState()
      .load(folder)
      .catch((reason) => setError(errorText(reason)));
  }, [folder]);

  const openEditor = useCallback(
    (index: number | null) => {
      // Read from the store, not this render, so a request from another menu sees the latest.
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
    void runLaunchScript(folder, entry).catch((reason: unknown) => {
      // A run that fails is never silent: the editor opens with what went wrong.
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
    <div className="launch-script-actions">
      {primary?.label ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="launch-script-named"
          title={`${primary.label}: ${primary.script}`}
          onClick={() => run(primary, 0)}
          onContextMenu={(event) => {
            event.preventDefault();
            openEditor(0);
          }}
        >
          <Play size={14} />
          <span className="truncate">{primary.label}</span>
        </Button>
      ) : (
        <IconButton
          label={primaryLabel}
          tooltip={primary ? `${primaryLabel}: ${primary.script}` : primaryLabel}
          onClick={() => (primary ? run(primary, 0) : openEditor(null))}
          onContextMenu={(event) => {
            event.preventDefault();
            openEditor(primary ? 0 : null);
          }}
        >
          <Play size={15} />
        </IconButton>
      )}
      {rest.map((entry, index) => (
        <Button
          key={entry.id}
          type="button"
          variant="ghost"
          size="sm"
          className="launch-script-named"
          title={entry.script}
          onClick={() => run(entry, index + 1)}
          onContextMenu={(event) => {
            event.preventDefault();
            openEditor(index + 1);
          }}
        >
          <Play size={14} />
          <span className="truncate">{entry.label || entry.script}</span>
        </Button>
      ))}
      <Dialog open={editIndex !== false} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent aria-describedby={undefined} className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-sm">Start command</DialogTitle>
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
            <div className="launch-script-new">
              <h3 className="launch-script-new-title">New command</h3>
              <ScriptFields
                idPrefix="launch-script-new"
                label={newLabel}
                script={newScript}
                onLabel={setNewLabel}
                onScript={setNewScript}
              />
              <div className="launch-script-new-actions">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowNew(false)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={!newScript.trim()} onClick={createNew}>
                  Add command
                </Button>
              </div>
            </div>
          ) : null}
          <ErrorNotification message={error} onDismiss={() => setError("")} />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>
              Cancel
            </Button>
            {showNew ? null : (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNew(true)}>
                New command
              </Button>
            )}
            <Button type="button" size="sm" onClick={saveEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
