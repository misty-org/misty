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
  SkeletonList,
  Spinner,
  Text,
  Textarea,
  TreeRow,
} from "@misty/ui";
import { FileNameIcon } from "@/features/files";
import { formatDriveBytes } from "../drive/drive_entries";
import type { DriveEntry } from "../drive/drive_native";
import { folderNative, type FolderScan } from "./folder_native";
import { buildTree, toggledIgnore, visibleRows, type FolderNode } from "./folder_tree";
import { copyFolderIntoSpace, folderNameFromPath } from "./share_folder";

export function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  return fallback;
}

export function CopyFolderDialog({
  open,
  onOpenChange,
  spaceId,
  localFolder,
  onCopied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  localFolder: string;
  onCopied: (folder: DriveEntry) => void;
}) {
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [ignore, setIgnore] = useState("");
  const ignoreRef = useRef("");
  const [draft, setDraft] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const name = folderNameFromPath(localFolder);

  useEffect(() => {
    if (!open) return;
    setScan(null);
    setIgnore("");
    ignoreRef.current = "";
    setDraft(null);
    setExpanded(new Set());
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
  }, [open, localFolder]);

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

  const copy = async () => {
    setBusy(true);
    setError("");
    try {
      if (draft !== null && draft !== ignoreRef.current) {
        ignoreRef.current = draft;
        setIgnore(draft);
        await folderNative.writeIgnore(localFolder, draft);
      }
      onCopied(await copyFolderIntoSpace(spaceId, localFolder));
      onOpenChange(false);
    } catch (cause) {
      setError(errorText(cause, "The folder couldn't be copied. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const empty = scan !== null && scan.included.length === 0 && scan.excluded.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="lg" layout="scroll" hideClose={busy}>
        <DialogHeader>
          <DialogTitle>{`Copy ${name} into the Space`}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid content-start gap-4">
          {scan === null ? (
            error ? null : (
              <SkeletonList label="Folder contents" rows={6} leading="icon" />
            )
          ) : empty ? (
            <EmptyState inline title="Nothing to copy" line="This folder has no files." />
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
                    icon={
                      <FileNameIcon
                        name={node.name}
                        kind={node.dir ? "folder" : "file"}
                        open={opens && expanded.has(node.path)}
                      />
                    }
                    dimmed={node.excluded}
                    leading={
                      <Checkbox
                        checked={!node.excluded}
                        disabled={busy}
                        aria-label={`Copy ${node.path}`}
                        onCheckedChange={(value) => toggle(node, value === true)}
                      />
                    }
                    end={
                      !node.excluded && node.size > 0 ? (
                        <Text size="meta" tone="muted">
                          {formatDriveBytes(node.size)}
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
              This folder is too big to show whole. Everything not left out is copied.
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
          {busy ? (
            <div className="flex items-center gap-2" aria-live="polite">
              <Spinner label={`Copying ${name}`} />
              <Text size="meta" tone="muted">
                {`Copying ${name}`}
              </Text>
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
            onClick={() => void copy()}
          >
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
