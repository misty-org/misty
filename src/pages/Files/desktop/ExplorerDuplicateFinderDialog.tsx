import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { duplicatesCancel, duplicatesHashRemoteCandidates, duplicatesScan, explorerQueueDeleteItems, explorerQueuePasteItems } from "../../../api/misty";
import type { DuplicateGroup, DuplicateScanResult, PasteItem } from "../../../api/types";
import { useOperationQueueStore } from "../../../stores/useOperationQueueStore";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useTransfersStore } from "../../../stores/useTransfersStore";
import { errorText } from "../../../shared/format";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { cx } from "./ExplorerDesktopShared";
import { dialogStyles, duplicateFinderStyles } from "./ExplorerDesktopDialogStyles";

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
  const [cleanupMoveDestination, setCleanupMoveDestination] = useState(initialRoot.startsWith("misty://") ? "/" : initialRoot);
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
      useExplorerStore.getState().pushNotification(`Queued ${cleanupMode} cleanup for ${duplicateItemCountLabel(safePaths.length)}`, "success");
      void useExplorerStore.getState().refreshPane(props.paneId);
      props.onClose();
    } catch (cleanupError) {
      setError(errorText(cleanupError));
    }
  }, [cleanupMode, cleanupMoveDestination, props, result?.groups, selectedCleanupPaths.length, selectedSet]);

  return createPortal(
    <div className={dialogStyles.backdrop} role="presentation">
      <form
        className={cx(dialogStyles.dialog, dialogStyles.wide)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-finder-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void runScan();
        }}
      >
        <header className={dialogStyles.batchHeader}>
          <div>
            <h2 className={dialogStyles.title} id="duplicate-finder-title">Duplicate Finder</h2>
            <p className={dialogStyles.text}>Scan folders, review duplicate candidates, then queue cleanup.</p>
          </div>
          <span className={dialogStyles.batchBadge}>{result ? `${result.groups.length} groups` : "Preview first"}</span>
        </header>
        <div className={duplicateFinderStyles.body}>
          <div className={duplicateFinderStyles.controls}>
            <label className={dialogStyles.batchField}>
              <span>Scan roots</span>
              <textarea
                className={duplicateFinderStyles.rootsInput}
                value={rootsText}
                spellCheck={false}
                onChange={(event) => setRootsText(event.target.value)}
              />
            </label>
            <div className="grid gap-2">
              <button className={dialogStyles.actionButton} type="submit" disabled={scanning}>
                {scanning ? "Scanning" : "Scan"}
              </button>
              <button className={dialogStyles.actionButton} type="button" disabled={!scanning || !result?.scanId} onClick={cancelScan}>Cancel</button>
            </div>
          </div>
          <label className={duplicateFinderStyles.optionRow}>
            <input className={duplicateFinderStyles.checkbox} type="checkbox" checked={hashAll} onChange={(event) => setHashAll(event.target.checked)} />
            <span>Hash all duplicate-size candidates for exact matches</span>
          </label>
          {remoteApprovalPending ? (
            <div className={duplicateFinderStyles.warning}>
              {result?.remoteCandidateCount ?? 0} remote candidates need explicit download approval before hashing.
              <button className={dialogStyles.actionButton} type="button" onClick={approveRemoteHash}>Approve Remote Hashing</button>
            </div>
          ) : null}
          {error ? <div className={duplicateFinderStyles.error}>{error}</div> : null}
          {result ? (
            <div className={duplicateFinderStyles.summary}>
              <span>{result.message}</span>
              <span>{result.scannedCount} scanned, {result.hashedCount} hashed, {cleanupCount} selected for cleanup ({formatBytes(cleanupBytes)}).</span>
            </div>
          ) : null}
          {result && result.groups.length === 0 ? (
            <div className={duplicateFinderStyles.empty}>No duplicate candidates found for the current scan.</div>
          ) : null}
          {result && result.groups.length > 0 ? (
            <div className={duplicateFinderStyles.groupList}>
              {result.groups.map((group) => (
                <section className={duplicateFinderStyles.group} key={group.key}>
                  <header className={duplicateFinderStyles.groupHeader}>
                    <strong>{group.items.length} copies · {formatBytes(group.sizeBytes)}</strong>
                    <span className={duplicateFinderStyles.groupMeta}>{group.key}</span>
                  </header>
                  {group.items.map((item) => {
                    const selected = selectedSet.has(item.path);
                    return (
                      <label className={duplicateFinderStyles.candidate} key={item.path}>
                        <input
                          className={duplicateFinderStyles.checkbox}
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleCleanupPath(group, item.path)}
                        />
                        <span className="grid min-w-0 gap-1">
                          <span className={duplicateFinderStyles.candidatePath} title={item.path}>{item.path}</span>
                          <small className={duplicateFinderStyles.candidateMeta}>{formatDate(item.modifiedMs)}{item.sha256 ? ` · ${item.sha256.slice(0, 12)}` : ""}</small>
                        </span>
                        <span className={duplicateFinderStyles.groupMeta}>{selected ? (cleanupMode === "move" ? "Move" : "Trash") : "Keep"}</span>
                      </label>
                    );
                  })}
                </section>
              ))}
            </div>
          ) : null}
        </div>
        <div className={dialogStyles.actions}>
          <select className={dialogStyles.input} value={cleanupMode} onChange={(event) => setCleanupMode(event.target.value === "move" ? "move" : "trash")}>
            <option value="trash">Trash selected</option>
            <option value="move">Move selected</option>
          </select>
          {cleanupMode === "move" ? (
            <input
              className={dialogStyles.input}
              value={cleanupMoveDestination}
              placeholder="Destination folder"
              aria-label="Duplicate cleanup destination"
              onChange={(event) => setCleanupMoveDestination(event.target.value)}
            />
          ) : null}
          <button className={dialogStyles.actionButton} type="button" onClick={props.onClose}>Close</button>
          <button className={dialogStyles.actionButton} type="button" disabled={cleanupCount === 0} onClick={() => void queueCleanup()}>Queue Cleanup</button>
        </div>
      </form>
    </div>,
    document.body,
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
  return duplicateSafeCleanupItems(groups, selected).reduce((total, item) => total + (item.sizeBytes ?? 0), 0);
}

function duplicateItemCountLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}
