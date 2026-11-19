import { File, Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  Input,
  Progress,
  SkeletonList,
  Text,
  Textarea,
  TreeRow,
} from "@/shared/ui";
import { formatBytes } from "../library/libraryFormat";
import { folderNative, type FolderScan } from "./folderNative";
import { buildTree, toggledIgnore, visibleRows, type FolderNode } from "./folderTree";
import { folderNameFromPath, uploadFolder, type ShareProgress } from "./shareFolder";
import type { SpaceFolder } from "./spaceFoldersApi";

export function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  return fallback;
}

function progressLine(progress: ShareProgress): string {
  if (progress.stage === "reading") return `Reading ${progress.done} of ${progress.total} files`;
  if (progress.stage === "saving") return "Saving the folder";
  if (progress.total === 0) return "The server already has every file";
  return `Uploading ${progress.done} of ${progress.total} files, ${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}`;
}

function progressValue(progress: ShareProgress): number {
  if (progress.stage === "saving") return 100;
  if (progress.bytesTotal > 0) return Math.round((progress.bytesDone / progress.bytesTotal) * 100);
  return progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 100;
}

/**
 * Shares a folder the person picked, or uploads its changes to a shared folder: the folder's
 * tree with a checkbox on each file and folder (unchecking writes a `.mistyignore` rule), the
 * `.mistyignore` itself to edit, then the upload with its progress.
 */
export function ShareFolderDialog({
  open,
  onOpenChange,
  spaceId,
  localFolder,
  target,
  onShared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  /** The folder on this computer, picked in the system's dialog. */
  localFolder: string;
  /** Upload changes to this shared folder; without it a new one is made. */
  target?: SpaceFolder;
  onShared: (folder: SpaceFolder) => void;
}) {
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [ignore, setIgnore] = useState("");
  const ignoreRef = useRef("");
  /** The `.mistyignore` box's text while it is open. */
  const [draft, setDraft] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [progress, setProgress] = useState<ShareProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const targetName = target?.name;

  useEffect(() => {
    if (!open) return;
    setScan(null);
    setIgnore("");
    ignoreRef.current = "";
    setDraft(null);
    setExpanded(new Set());
    setName(targetName ?? folderNameFromPath(localFolder));
    setNameError("");
    setProgress(null);
    setBusy(false);
    setError("");
    const run = ++sequence.current;
    void Promise.all([folderNative.scan(localFolder), folderNative.readIgnore(localFolder)])
      .then(([found, text]) => {
        if (run !== sequence.current) return;
        ignoreRef.current = text;
        setIgnore(text);
        setScan(found);
      })
      .catch((cause) => {
        if (run === sequence.current)
          setError(errorText(cause, "Misty couldn't read that folder."));
      });
  }, [open, localFolder, targetName]);

  const tree = useMemo(() => (scan ? buildTree(scan) : []), [scan]);
  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);

  const saveIgnore = async (next: string) => {
    ignoreRef.current = next;
    setIgnore(next);
    setDraft((current) => (current === null ? null : next));
    setError("");
    const run = ++sequence.current;
    try {
      await folderNative.writeIgnore(localFolder, next);
      const found = await folderNative.scan(localFolder);
      if (run === sequence.current) setScan(found);
    } catch (cause) {
      if (run === sequence.current) setError(errorText(cause, "Misty couldn't save .mistyignore."));
    }
  };

  const toggle = (node: FolderNode, include: boolean) =>
    void saveIgnore(toggledIgnore(ignoreRef.current, node, include));

  const toggleOpen = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const share = async () => {
    if (!target && !name.trim()) {
      setNameError("Name the folder.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Rules still in the box count.
      if (draft !== null && draft !== ignoreRef.current) {
        ignoreRef.current = draft;
        setIgnore(draft);
        await folderNative.writeIgnore(localFolder, draft);
      }
      const folder = await uploadFolder({
        spaceId,
        localFolder,
        name: name.trim(),
        folderId: target?.id,
        onProgress: setProgress,
      });
      onShared(folder);
      onOpenChange(false);
    } catch (cause) {
      setProgress(null);
      setError(errorText(cause, "The folder couldn't be uploaded. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const empty = scan !== null && scan.included.length === 0 && scan.excluded.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="lg" layout="scroll" hideClose={busy}>
        <DialogHeader>
          <DialogTitle>
            {target ? `Upload changes to ${target.name}` : "Share a folder"}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="grid content-start gap-4">
          {target ? null : (
            <Field label="Name" error={nameError}>
              <Input
                value={name}
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError("");
                }}
              />
            </Field>
          )}
          {scan === null ? (
            error ? null : (
              <SkeletonList label="Folder contents" rows={6} leading="icon" />
            )
          ) : empty ? (
            <EmptyState inline title="Nothing to share" line="This folder has no files." />
          ) : (
            <div role="group" aria-label="Folder contents" className="grid min-w-0">
              {rows.map(({ node, depth }) => {
                const opens = node.dir && !node.excluded;
                return (
                  <TreeRow
                    key={node.path}
                    label={node.name}
                    full={node.path}
                    depth={depth}
                    chevron={opens}
                    expanded={opens ? expanded.has(node.path) : undefined}
                    icon={node.dir ? <Folder /> : <File />}
                    dimmed={node.excluded}
                    leading={
                      <Checkbox
                        checked={!node.excluded}
                        disabled={busy}
                        aria-label={`Share ${node.path}`}
                        onCheckedChange={(value) => toggle(node, value === true)}
                      />
                    }
                    end={
                      !node.excluded && node.size > 0 ? (
                        <Text size="meta" tone="muted">
                          {formatBytes(node.size)}
                        </Text>
                      ) : undefined
                    }
                    onOpen={() => (opens ? toggleOpen(node.path) : toggle(node, node.excluded))}
                  />
                );
              })}
            </div>
          )}
          {scan?.truncated ? (
            <Text size="meta" tone="muted" wrap>
              This folder is too big to show whole. Everything not left out is shared.
            </Text>
          ) : null}
          {scan === null ? null : draft === null ? (
            <div>
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={() => setDraft(ignore)}
              >
                Edit .mistyignore
              </Button>
            </div>
          ) : (
            <Field label=".mistyignore">
              <Textarea
                variant="code"
                value={draft}
                disabled={busy}
                placeholder="build/"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  if (draft !== ignoreRef.current) void saveIgnore(draft);
                }}
              />
            </Field>
          )}
          {progress ? (
            <div className="grid gap-2" aria-live="polite">
              <Text size="meta" tone="muted">
                {progressLine(progress)}
              </Text>
              <Progress value={progressValue(progress)} aria-label="Upload progress" />
            </div>
          ) : null}
          <FieldError message={error} />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="quiet"
            size="lg"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={busy || scan === null || empty}
            onClick={() => void share()}
          >
            {target ? "Upload changes" : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
