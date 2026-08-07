import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card } from "@/ui";
import { Checkbox } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Textarea } from "@/ui";
import {
  duplicatesCancel,
  duplicatesHashRemoteCandidates,
  duplicatesScan,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
} from "@/stores/backend";
import type {
  DuplicateGroup,
  DuplicateScanResult,
  PasteItem,
} from "@/models/interfaces/services/misty-api";
import { useOperationQueueStore } from "@/stores/explorer";
import { useExplorerStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import { errorText } from "@/lib/format";
import { formatBytes, formatDate } from "../utils/fileFormat";

const dialogChromeClass =
  "flex max-h-[min(760px,calc(100vh-48px))] w-[min(760px,calc(100vw-48px))] max-w-none flex-col overflow-hidden bg-charcoal-card p-0 text-cream";
const bodyClass = "min-h-0 overflow-auto p-4";
const fieldClass = "grid gap-1.5 text-xs font-medium text-cream-muted";
const groupListClass = "mt-4 grid max-h-[360px] gap-3 overflow-auto pr-1";

export function DuplicateFinderDialog(props: {
  paneId: string;
  defaultRoot: string;
  onClose: () => void;
}) {
  const initialRoot = props.defaultRoot || "/";
  const [rootsText, setRootsText] = useState(initialRoot);
  const [hashAll, setHashAll] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [remoteApprovalPending, setRemoteApprovalPending] = useState(false);
  const [result, setResult] = useState<DuplicateScanResult | null>(null);
  const [selectedCleanupPaths, setSelectedCleanupPaths] = useState<string[]>([]);
  const [cleanupMode, setCleanupMode] = useState<"trash" | "move">("trash");
  const [cleanupMoveDestination, setCleanupMoveDestination] = useState(
    initialRoot.startsWith("misty://") ? "/" : initialRoot,
  );
  const [error, setError] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedCleanupPaths), [selectedCleanupPaths]);
  const roots = useMemo(() => parseDuplicateRoots(rootsText), [rootsText]);
  const cleanupCount = selectedCleanupPaths.length;
  const cleanupBytes = useMemo(
    () => duplicateCleanupBytes(result?.groups ?? [], selectedSet),
    [result?.groups, selectedSet],
  );

  const runScan = useCallback(async () => {
    if (roots.length === 0) {
      setError("Add at least one folder to scan.");
      return;
    }
    setScanning(true);
    setError(null);
    setRemoteApprovalPending(false);
    try {
      const next = await duplicatesScan({ roots, hashAll });
      setResult(next);
      setSelectedCleanupPaths(defaultDuplicateCleanupPaths(next.groups));
      setRemoteApprovalPending(next.remoteCandidateCount > 0 && !next.remoteHashingApproved);
    } catch (scanError) {
      setError(errorText(scanError));
    } finally {
      setScanning(false);
    }
  }, [hashAll, roots]);

  const cancelScan = useCallback(() => {
    if (!result?.scanId) return;
    void duplicatesCancel(result.scanId).catch(() => undefined);
    setScanning(false);
  }, [result?.scanId]);

  const approveRemoteHash = useCallback(async () => {
    if (!result?.scanId) return;
    setError(null);
    try {
      const next = await duplicatesHashRemoteCandidates(result.scanId);
      setResult(next);
      setSelectedCleanupPaths(defaultDuplicateCleanupPaths(next.groups));
      setRemoteApprovalPending(next.remoteCandidateCount > 0 && !next.remoteHashingApproved);
    } catch (approvalError) {
      setError(errorText(approvalError));
    }
  }, [result?.scanId]);

  const toggleCleanupPath = useCallback((group: DuplicateGroup, path: string) => {
    setSelectedCleanupPaths((current) => {
      const currentSet = new Set(current);
      if (currentSet.has(path)) {
        currentSet.delete(path);
        return [...currentSet];
      }
      const selectedInGroup = group.items.filter((item) => currentSet.has(item.path)).length;
      if (selectedInGroup >= group.items.length - 1) return current;
      currentSet.add(path);
      return [...currentSet];
    });
  }, []);

  const queueCleanup = useCallback(async () => {
    if (selectedCleanupPaths.length === 0) return;
    const safeItems = duplicateSafeCleanupItems(result?.groups ?? [], selectedSet);
    if (safeItems.length === 0) {
      setError("Keep at least one file in every duplicate group.");
      return;
    }
    const safePaths = safeItems.map((item) => item.path);
    try {
      if (cleanupMode === "move") {
        const destinationDirectory = cleanupMoveDestination.trim();
        if (!destinationDirectory) {
          setError("Choose a destination folder for move cleanup.");
          return;
        }
        const localItems = safeItems.filter((item) => !item.remote);
        const remoteItems = safeItems.filter((item) => item.remote);
        for (const items of [localItems, remoteItems]) {
          if (items.length === 0) continue;
          await explorerQueuePasteItems({
            sources: items.map((item): PasteItem => ({ path: item.path, isDirectory: false })),
            destinationDirectory,
            operation: "move",
          });
        }
      } else {
        await explorerQueueDeleteItems({ paths: safePaths, permanent: false });
      }
      void useTransfersStore.getState().load(undefined, { silent: true });
      void useOperationQueueStore.getState().load({ silent: true });
      useExplorerStore
        .getState()
        .pushNotification(
          `Queued ${cleanupMode} cleanup for ${duplicateItemCountLabel(safePaths.length)}`,
          "success",
        );
      void useExplorerStore.getState().refreshPane(props.paneId);
      props.onClose();
    } catch (cleanupError) {
      setError(errorText(cleanupError));
    }
  }, [
    cleanupMode,
    cleanupMoveDestination,
    props,
    result?.groups,
    selectedCleanupPaths.length,
    selectedSet,
  ]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className={dialogChromeClass}>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void runScan();
          }}
        >
          <DialogHeader className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-charcoal-border px-5 py-4 text-left">
            <div>
              <DialogTitle>Duplicate Finder</DialogTitle>
              <DialogDescription>
                Scan folders, review duplicate candidates, then queue cleanup.
              </DialogDescription>
            </div>
            <Badge variant="secondary">
              {result ? `${result.groups.length} groups` : "Preview first"}
            </Badge>
          </DialogHeader>
          <div className={bodyClass}>
            <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3 max-[720px]:grid-cols-1">
              <label className={fieldClass}>
                <span>Scan roots</span>
                <Textarea
                  className="min-h-24"
                  value={rootsText}
                  spellCheck={false}
                  onChange={(event) => setRootsText(event.target.value)}
                />
              </label>
              <div className="grid gap-2">
                <Button type="submit" disabled={scanning}>
                  {scanning ? "Scanning" : "Scan"}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  disabled={!scanning || !result?.scanId}
                  onClick={cancelScan}
                >
                  Cancel
                </Button>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-md bg-charcoal-card px-3 py-2 text-xs text-cream">
              <Checkbox
                checked={hashAll}
                onCheckedChange={(checked) => setHashAll(Boolean(checked))}
              />
              <span>Hash all duplicate-size candidates for exact matches</span>
            </label>
            {remoteApprovalPending ? (
              <Card className="mt-3 flex flex-wrap items-center justify-between gap-3 border-0 bg-sage-bg p-3 text-sm text-sage-fg shadow-none text-sage-fg">
                {result?.remoteCandidateCount ?? 0} remote candidates need explicit download
                approval before hashing.
                <Button variant="outline" type="button" onClick={approveRemoteHash}>
                  Approve Remote Hashing
                </Button>
              </Card>
            ) : null}
            {error ? (
              <div className="mt-3 rounded-lg border border-charcoal-active/25 bg-charcoal-active px-3 py-2 text-sm text-cream-bright">
                {error}
              </div>
            ) : null}
            {result ? (
              <Card className="mt-3 grid gap-1 border-0 bg-charcoal-card p-3 text-sm text-cream-muted shadow-none">
                <span>{result.message}</span>
                <span>
                  {result.scannedCount} scanned, {result.hashedCount} hashed, {cleanupCount}{" "}
                  selected for cleanup ({formatBytes(cleanupBytes)}).
                </span>
              </Card>
            ) : null}
            {result && result.groups.length === 0 ? (
              <Card className="mt-3 border-0 bg-charcoal-card p-5 text-center text-sm text-cream-muted shadow-none">
                No duplicate candidates found for the current scan.
              </Card>
            ) : null}
            {result && result.groups.length > 0 ? (
              <div className={groupListClass}>
                {result.groups.map((group) => (
                  <Card
                    className="overflow-hidden border-0 bg-charcoal-card shadow-none"
                    key={group.key}
                  >
                    <header className="flex items-center justify-between gap-3 border-b border-charcoal-border/70 px-3 py-2 text-xs">
                      <strong>
                        {group.items.length} copies · {formatBytes(group.sizeBytes)}
                      </strong>
                      <span className="truncate text-cream-muted">{group.key}</span>
                    </header>
                    {group.items.map((item) => {
                      const selected = selectedSet.has(item.path);
                      return (
                        <label
                          className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-charcoal-border/70 px-3 py-2 text-xs last:border-0"
                          key={item.path}
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleCleanupPath(group, item.path)}
                          />
                          <span className="grid min-w-0 gap-1">
                            <span className="truncate text-cream" title={item.path}>
                              {item.path}
                            </span>
                            <small className="text-cream-muted">
                              {formatDate(item.modifiedMs)}
                              {item.sha256 ? ` · ${item.sha256.slice(0, 12)}` : ""}
                            </small>
                          </span>
                          <Badge variant={selected ? "secondary" : "outline"}>
                            {selected ? (cleanupMode === "move" ? "Move" : "Trash") : "Keep"}
                          </Badge>
                        </label>
                      );
                    })}
                  </Card>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter className="mt-0 flex-row flex-wrap border-t border-charcoal-border px-5 py-4">
            <Select
              value={cleanupMode}
              onValueChange={(value) => setCleanupMode(value === "move" ? "move" : "trash")}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trash">Trash selected</SelectItem>
                <SelectItem value="move">Move selected</SelectItem>
              </SelectContent>
            </Select>
            {cleanupMode === "move" ? (
              <Input
                className="w-64"
                value={cleanupMoveDestination}
                placeholder="Destination folder"
                aria-label="Duplicate cleanup destination"
                onChange={(event) => setCleanupMoveDestination(event.target.value)}
              />
            ) : null}
            <Button variant="outline" type="button" onClick={props.onClose}>
              Close
            </Button>
            <Button type="button" disabled={cleanupCount === 0} onClick={() => void queueCleanup()}>
              Queue Cleanup
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function parseDuplicateRoots(value: string): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const line of value.split(/\r?\n|,/)) {
    const root = line.trim();
    if (!root || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

function defaultDuplicateCleanupPaths(groups: DuplicateGroup[]): string[] {
  return groups.flatMap((group) => group.items.slice(1).map((item) => item.path));
}

function duplicateSafeCleanupItems(groups: DuplicateGroup[], selected: Set<string>) {
  const items: DuplicateGroup["items"] = [];
  for (const group of groups) {
    const selectedInGroup = group.items.filter((item) => selected.has(item.path));
    if (selectedInGroup.length >= group.items.length) continue;
    items.push(...selectedInGroup);
  }
  return items;
}

function duplicateSafeCleanupPaths(groups: DuplicateGroup[], selected: Set<string>): string[] {
  return duplicateSafeCleanupItems(groups, selected).map((item) => item.path);
}

function duplicateCleanupBytes(groups: DuplicateGroup[], selected: Set<string>): number {
  return duplicateSafeCleanupItems(groups, selected).reduce(
    (total, item) => total + (item.sizeBytes ?? 0),
    0,
  );
}

function duplicateItemCountLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}
