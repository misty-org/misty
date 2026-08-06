import type {
  CompareMode,
  CompareTextDiffKind,
} from "@/models/types/features/explorer/desktop/ExplorerCompareDialog";
export type {
  CompareMode,
  CompareTextDiffKind,
} from "@/models/types/features/explorer/desktop/ExplorerCompareDialog";
import type {
  CompareDialogSeed,
  CompareTextDiffRow,
  CompareTextDiffState,
  CompareImagePreview,
  CompareImageState,
} from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";
export type {
  CompareDialogSeed,
  CompareTextDiffRow,
  CompareTextDiffState,
  CompareImagePreview,
  CompareImageState,
} from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";
import { useCallback, useState } from "react";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import {
  compareApplyTextMerge,
  compareFiles,
  compareFolders,
  explorerPreviewItem,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
} from "@/stores/backend";
import type {
  CompareFilesResult,
  CompareFolderRow,
  CompareFoldersResult,
  PasteItem,
} from "@/models/interfaces/services/misty-api";
import { useOperationQueueStore } from "@/stores/explorer";
import { useExplorerStore } from "@/stores/explorer";
import { errorText } from "@/lib/format";
import { formatBytes } from "../utils/fileFormat";
import { cx } from "./ExplorerDesktopShared";
import { compareStyles } from "./ExplorerDesktopDialogStyles";
import {
  CompareDiffLine,
  joinLocalPath,
  loadCompareImagePreview,
  loadCompareTextDiff,
  parentPath,
} from "./compareDialog/comparePreview";
import { leftDiffKind, rightDiffKind } from "./compareDialog/compareDiff";

export function CompareDialog(props: { seed: CompareDialogSeed; onClose: () => void }) {
  const [mode, setMode] = useState<CompareMode>(props.seed.mode);
  const [leftPath, setLeftPath] = useState(props.seed.leftPath);
  const [rightPath, setRightPath] = useState("");
  const [running, setRunning] = useState(false);
  const [applyingMerge, setApplyingMerge] = useState<"left" | "right" | null>(null);
  const [mergeTarget, setMergeTarget] = useState<"left" | "right" | null>(null);
  const [fileResult, setFileResult] = useState<CompareFilesResult | null>(null);
  const [folderResult, setFolderResult] = useState<CompareFoldersResult | null>(null);
  const [textDiff, setTextDiff] = useState<CompareTextDiffState | null>(null);
  const [imageCompare, setImageCompare] = useState<CompareImageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changedRows = folderResult?.rows.filter((row) => row.disposition !== "same") ?? [];

  const runCompare = useCallback(async () => {
    if (!leftPath.trim() || !rightPath.trim()) {
      setError("Choose both paths before comparing.");
      return;
    }
    setRunning(true);
    setError(null);
    setFileResult(null);
    setFolderResult(null);
    setTextDiff(null);
    setImageCompare(null);
    try {
      if (mode === "folder") {
        setFolderResult(
          await compareFolders({ leftPath: leftPath.trim(), rightPath: rightPath.trim() }),
        );
      } else {
        const result = await compareFiles({
          leftPath: leftPath.trim(),
          rightPath: rightPath.trim(),
        });
        setFileResult(result);
        const nextTextDiff = await loadCompareTextDiff(leftPath.trim(), rightPath.trim());
        setTextDiff(nextTextDiff);
        if (!nextTextDiff)
          setImageCompare(await loadCompareImagePreview(leftPath.trim(), rightPath.trim()));
      }
    } catch (compareError) {
      setError(errorText(compareError));
    } finally {
      setRunning(false);
    }
  }, [leftPath, mode, rightPath]);

  const applyTextMerge = useCallback(
    async (target: "left" | "right") => {
      if (!textDiff) return;
      const targetPath = target === "left" ? leftPath.trim() : rightPath.trim();
      const mergedText = target === "left" ? textDiff.rightText : textDiff.leftText;
      if (!targetPath) return;
      setApplyingMerge(target);
      setError(null);
      try {
        await compareApplyTextMerge(mergedText, targetPath);
        useExplorerStore.getState().pushNotification("Applied text merge.", "success", 3500);
        void runCompare();
      } catch (mergeError) {
        setError(errorText(mergeError));
      } finally {
        setApplyingMerge(null);
      }
    },
    [leftPath, rightPath, runCompare, textDiff],
  );

  const queueFolderCopy = useCallback(
    async (row: CompareFolderRow, direction: "left_to_right" | "right_to_left") => {
      if (!folderResult) return;
      const sourceRoot =
        direction === "left_to_right" ? folderResult.leftPath : folderResult.rightPath;
      const destinationRoot =
        direction === "left_to_right" ? folderResult.rightPath : folderResult.leftPath;
      const sourcePath = joinLocalPath(sourceRoot, row.relativePath);
      const destinationDirectory = parentPath(joinLocalPath(destinationRoot, row.relativePath));
      const source: PasteItem = { path: sourcePath, isDirectory: false };
      try {
        await explorerQueuePasteItems({
          sources: [source],
          destinationDirectory,
          operation: "copy",
        });
        useExplorerStore.getState().pushNotification("Queued compare copy.", "success");
        void useOperationQueueStore.getState().load({ silent: true });
      } catch (copyError) {
        setError(errorText(copyError));
      }
    },
    [folderResult],
  );

  const queueFolderDelete = useCallback(
    async (row: CompareFolderRow, side: "left" | "right") => {
      if (!folderResult) return;
      const path = joinLocalPath(
        side === "left" ? folderResult.leftPath : folderResult.rightPath,
        row.relativePath,
      );
      try {
        await explorerQueueDeleteItems({ paths: [path], permanent: false });
        useExplorerStore.getState().pushNotification("Queued compare cleanup.", "success");
        void useOperationQueueStore.getState().load({ silent: true });
      } catch (deleteError) {
        setError(errorText(deleteError));
      }
    },
    [folderResult],
  );

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        <DialogContent className="flex max-h-[min(760px,calc(100vh-48px))] w-[min(780px,calc(100vw-48px))] max-w-none flex-col overflow-hidden bg-charcoal-card p-0 text-cream">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void runCompare();
            }}
          >
            <DialogHeader className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-charcoal-border px-5 py-4 text-left">
              <div>
                <DialogTitle>Compare With</DialogTitle>
                <DialogDescription>
                  Compare files by hash or folders by relative inventory.
                </DialogDescription>
              </div>
              <Badge variant="secondary">{mode === "folder" ? "Folder" : "File"}</Badge>
            </DialogHeader>
            <div className={`${compareStyles.body} min-h-0 overflow-auto p-4`}>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={mode === "file" ? "default" : "outline"}
                  size="sm"
                  type="button"
                  onClick={() => setMode("file")}
                >
                  Files
                </Button>
                <Button
                  variant={mode === "folder" ? "default" : "outline"}
                  size="sm"
                  type="button"
                  onClick={() => setMode("folder")}
                >
                  Folders
                </Button>
              </div>
              <div className={compareStyles.fields}>
                <label className="grid gap-1.5 text-xs font-medium text-cream-muted">
                  <span>Left</span>
                  <Input value={leftPath} onChange={(event) => setLeftPath(event.target.value)} />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-cream-muted">
                  <span>Right</span>
                  <Input
                    autoFocus
                    value={rightPath}
                    onChange={(event) => setRightPath(event.target.value)}
                  />
                </label>
              </div>
              {error ? <div className={compareStyles.error}>{error}</div> : null}
              {fileResult ? (
                <div className={compareStyles.result}>
                  <strong>{fileResult.message}</strong>
                  <span>{textDiff ? "text compare" : `${fileResult.kind} compare`}</span>
                  <span>Left SHA-256</span>
                  <span className={compareStyles.hash} title={fileResult.leftSha256}>
                    {fileResult.leftSha256}
                  </span>
                  <span>Right SHA-256</span>
                  <span className={compareStyles.hash} title={fileResult.rightSha256}>
                    {fileResult.rightSha256}
                  </span>
                </div>
              ) : null}
              {textDiff ? (
                <div className={compareStyles.diffShell}>
                  <div className={compareStyles.diffHeader}>
                    <span>
                      {textDiff.rows.filter((row) => row.kind !== "same").length} changed lines
                      {textDiff.truncated ? " shown from the first 800 lines" : ""}
                    </span>
                    <span className={compareStyles.diffActions}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={Boolean(applyingMerge)}
                        onClick={() => setMergeTarget("right")}
                      >
                        {applyingMerge === "right" ? "Applying" : "Apply L to R"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={Boolean(applyingMerge)}
                        onClick={() => setMergeTarget("left")}
                      >
                        {applyingMerge === "left" ? "Applying" : "Apply R to L"}
                      </Button>
                    </span>
                  </div>
                  <div className={compareStyles.diffGrid}>
                    <div className={compareStyles.diffPane}>
                      <span className={compareStyles.diffPaneTitle}>Left</span>
                      {textDiff.rows.map((row) => (
                        <CompareDiffLine
                          key={`left:${row.id}`}
                          lineNumber={row.leftLine}
                          text={row.leftText}
                          kind={leftDiffKind(row)}
                        />
                      ))}
                    </div>
                    <div className={compareStyles.diffPane}>
                      <span className={compareStyles.diffPaneTitle}>Right</span>
                      {textDiff.rows.map((row) => (
                        <CompareDiffLine
                          key={`right:${row.id}`}
                          lineNumber={row.rightLine}
                          text={row.rightText}
                          kind={rightDiffKind(row)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              {imageCompare ? (
                <div className={compareStyles.imageGrid}>
                  <div className={compareStyles.imagePane}>
                    <span className={compareStyles.imageMeta}>
                      Left · {imageCompare.left.mimeType} ·{" "}
                      {formatBytes(imageCompare.left.byteLength)}
                    </span>
                    <span className={compareStyles.imageFrame}>
                      <img
                        className={compareStyles.imagePreview}
                        src={imageCompare.left.src}
                        alt="Left file preview"
                      />
                    </span>
                  </div>
                  <div className={compareStyles.imagePane}>
                    <span className={compareStyles.imageMeta}>
                      Right · {imageCompare.right.mimeType} ·{" "}
                      {formatBytes(imageCompare.right.byteLength)}
                    </span>
                    <span className={compareStyles.imageFrame}>
                      <img
                        className={compareStyles.imagePreview}
                        src={imageCompare.right.src}
                        alt="Right file preview"
                      />
                    </span>
                  </div>
                </div>
              ) : null}
              {folderResult ? (
                <>
                  <div className={compareStyles.result}>
                    <strong>{folderResult.message}</strong>
                    <span>
                      {changedRows.length} changed, {folderResult.rows.length - changedRows.length}{" "}
                      same.
                    </span>
                  </div>
                  {changedRows.length === 0 ? (
                    <div className={compareStyles.empty}>No folder differences found.</div>
                  ) : (
                    <div className={compareStyles.rowList}>
                      {changedRows.slice(0, 250).map((row) => (
                        <div
                          className={compareStyles.row}
                          key={`${row.disposition}:${row.relativePath}`}
                        >
                          <span className={compareStyles.rowPath} title={row.relativePath}>
                            {row.relativePath}
                          </span>
                          <span className={compareStyles.rowMeta}>
                            {row.disposition.replace(/_/g, " ")}
                          </span>
                          <span className={compareStyles.rowMeta}>
                            {formatBytes(row.leftSize ?? null)} /{" "}
                            {formatBytes(row.rightSize ?? null)}
                          </span>
                          <span className={compareStyles.rowActions}>
                            {row.leftSize != null ? (
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => void queueFolderCopy(row, "left_to_right")}
                              >
                                Copy R
                              </Button>
                            ) : null}
                            {row.rightSize != null ? (
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => void queueFolderCopy(row, "right_to_left")}
                              >
                                Copy L
                              </Button>
                            ) : null}
                            {row.leftSize != null ? (
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => void queueFolderDelete(row, "left")}
                              >
                                Trash L
                              </Button>
                            ) : null}
                            {row.rightSize != null ? (
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => void queueFolderDelete(row, "right")}
                              >
                                Trash R
                              </Button>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <DialogFooter className="mt-0 border-t border-charcoal-border px-5 py-4">
              <Button variant="outline" type="button" onClick={props.onClose}>
                Close
              </Button>
              <Button type="submit" disabled={running}>
                {running ? "Comparing" : "Compare"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={mergeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMergeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace file text?</AlertDialogTitle>
            <AlertDialogDescription>
              Replace{" "}
              <strong className="break-all font-medium text-cream">
                {mergeTarget === "left" ? leftPath.trim() : rightPath.trim()}
              </strong>{" "}
              with the {mergeTarget === "left" ? "right" : "left"} file’s text. This overwrites the
              current contents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mergeTarget) void applyTextMerge(mergeTarget);
                setMergeTarget(null);
              }}
            >
              Replace text
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
