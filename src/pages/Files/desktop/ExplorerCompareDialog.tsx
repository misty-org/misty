import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { compareApplyTextMerge, compareFiles, compareFolders, explorerPreviewItem, explorerQueueDeleteItems, explorerQueuePasteItems } from "../../../api/misty";
import type { CompareFilesResult, CompareFolderRow, CompareFoldersResult, PasteItem } from "../../../api/types";
import { useOperationQueueStore } from "../../../stores/useOperationQueueStore";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { errorText } from "../../../shared/format";
import { formatBytes } from "../utils/fileFormat";
import { cx } from "./ExplorerDesktopShared";
import { compareStyles, dialogStyles } from "./ExplorerDesktopDialogStyles";

type CompareMode = "file" | "folder";

export interface CompareDialogSeed {
  paneId: string;
  leftPath: string;
  mode: CompareMode;
}

type CompareTextDiffKind = "same" | "added" | "removed" | "changed";

interface CompareTextDiffRow {
  id: string;
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
  kind: CompareTextDiffKind;
}

interface CompareTextDiffState {
  leftText: string;
  rightText: string;
  rows: CompareTextDiffRow[];
  truncated: boolean;
}

interface CompareImagePreview {
  src: string;
  mimeType: string;
  byteLength: number;
}

interface CompareImageState {
  left: CompareImagePreview;
  right: CompareImagePreview;
}

export function CompareDialog(props: {
  seed: CompareDialogSeed;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<CompareMode>(props.seed.mode);
  const [leftPath, setLeftPath] = useState(props.seed.leftPath);
  const [rightPath, setRightPath] = useState("");
  const [running, setRunning] = useState(false);
  const [applyingMerge, setApplyingMerge] = useState<"left" | "right" | null>(null);
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
        setFolderResult(await compareFolders({ leftPath: leftPath.trim(), rightPath: rightPath.trim() }));
      } else {
        const result = await compareFiles({ leftPath: leftPath.trim(), rightPath: rightPath.trim() });
        setFileResult(result);
        const nextTextDiff = await loadCompareTextDiff(leftPath.trim(), rightPath.trim());
        setTextDiff(nextTextDiff);
        if (!nextTextDiff) setImageCompare(await loadCompareImagePreview(leftPath.trim(), rightPath.trim()));
      }
    } catch (compareError) {
      setError(errorText(compareError));
    } finally {
      setRunning(false);
    }
  }, [leftPath, mode, rightPath]);

  const applyTextMerge = useCallback(async (target: "left" | "right") => {
    if (!textDiff) return;
    const targetPath = target === "left" ? leftPath.trim() : rightPath.trim();
    const mergedText = target === "left" ? textDiff.rightText : textDiff.leftText;
    if (!targetPath || !window.confirm(`Replace ${targetPath} with the ${target === "left" ? "right" : "left"} text?`)) return;
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
  }, [leftPath, rightPath, runCompare, textDiff]);

  const queueFolderCopy = useCallback(async (row: CompareFolderRow, direction: "left_to_right" | "right_to_left") => {
    if (!folderResult) return;
    const sourceRoot = direction === "left_to_right" ? folderResult.leftPath : folderResult.rightPath;
    const destinationRoot = direction === "left_to_right" ? folderResult.rightPath : folderResult.leftPath;
    const sourcePath = joinLocalPath(sourceRoot, row.relativePath);
    const destinationDirectory = parentPath(joinLocalPath(destinationRoot, row.relativePath));
    const source: PasteItem = { path: sourcePath, isDirectory: false };
    try {
      await explorerQueuePasteItems({ sources: [source], destinationDirectory, operation: "copy" });
      useExplorerStore.getState().pushNotification("Queued compare copy.", "success");
      void useOperationQueueStore.getState().load({ silent: true });
    } catch (copyError) {
      setError(errorText(copyError));
    }
  }, [folderResult]);

  const queueFolderDelete = useCallback(async (row: CompareFolderRow, side: "left" | "right") => {
    if (!folderResult) return;
    const path = joinLocalPath(side === "left" ? folderResult.leftPath : folderResult.rightPath, row.relativePath);
    try {
      await explorerQueueDeleteItems({ paths: [path], permanent: false });
      useExplorerStore.getState().pushNotification("Queued compare cleanup.", "success");
      void useOperationQueueStore.getState().load({ silent: true });
    } catch (deleteError) {
      setError(errorText(deleteError));
    }
  }, [folderResult]);

  return createPortal(
    <div className={dialogStyles.backdrop} role="presentation">
      <form
        className={cx(dialogStyles.dialog, dialogStyles.wide)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void runCompare();
        }}
      >
        <header className={dialogStyles.batchHeader}>
          <div>
            <h2 className={dialogStyles.title} id="compare-dialog-title">Compare With</h2>
            <p className={dialogStyles.text}>Compare files by hash or folders by relative inventory.</p>
          </div>
          <span className={dialogStyles.batchBadge}>{mode === "folder" ? "Folder" : "File"}</span>
        </header>
        <div className={compareStyles.body}>
          <div className={compareStyles.modeRow}>
            <button className={cx(compareStyles.modeButton, mode === "file" && compareStyles.modeButtonActive)} type="button" onClick={() => setMode("file")}>Files</button>
            <button className={cx(compareStyles.modeButton, mode === "folder" && compareStyles.modeButtonActive)} type="button" onClick={() => setMode("folder")}>Folders</button>
          </div>
          <div className={compareStyles.fields}>
            <label className={dialogStyles.batchField}>
              <span>Left</span>
              <input className={dialogStyles.input} value={leftPath} onChange={(event) => setLeftPath(event.target.value)} />
            </label>
            <label className={dialogStyles.batchField}>
              <span>Right</span>
              <input className={dialogStyles.input} autoFocus value={rightPath} onChange={(event) => setRightPath(event.target.value)} />
            </label>
          </div>
          {error ? <div className={compareStyles.error}>{error}</div> : null}
          {fileResult ? (
            <div className={compareStyles.result}>
              <strong>{fileResult.message}</strong>
              <span>{textDiff ? "text compare" : `${fileResult.kind} compare`}</span>
              <span>Left SHA-256</span>
              <span className={compareStyles.hash} title={fileResult.leftSha256}>{fileResult.leftSha256}</span>
              <span>Right SHA-256</span>
              <span className={compareStyles.hash} title={fileResult.rightSha256}>{fileResult.rightSha256}</span>
            </div>
          ) : null}
          {textDiff ? (
            <div className={compareStyles.diffShell}>
              <div className={compareStyles.diffHeader}>
                <span>{textDiff.rows.filter((row) => row.kind !== "same").length} changed lines{textDiff.truncated ? " shown from the first 800 lines" : ""}</span>
                <span className={compareStyles.diffActions}>
                  <button className={compareStyles.miniButton} type="button" disabled={Boolean(applyingMerge)} onClick={() => void applyTextMerge("right")}>
                    {applyingMerge === "right" ? "Applying" : "Apply L to R"}
                  </button>
                  <button className={compareStyles.miniButton} type="button" disabled={Boolean(applyingMerge)} onClick={() => void applyTextMerge("left")}>
                    {applyingMerge === "left" ? "Applying" : "Apply R to L"}
                  </button>
                </span>
              </div>
              <div className={compareStyles.diffGrid}>
                <div className={compareStyles.diffPane}>
                  <span className={compareStyles.diffPaneTitle}>Left</span>
                  {textDiff.rows.map((row) => (
                    <CompareDiffLine key={`left:${row.id}`} lineNumber={row.leftLine} text={row.leftText} kind={leftDiffKind(row)} />
                  ))}
                </div>
                <div className={compareStyles.diffPane}>
                  <span className={compareStyles.diffPaneTitle}>Right</span>
                  {textDiff.rows.map((row) => (
                    <CompareDiffLine key={`right:${row.id}`} lineNumber={row.rightLine} text={row.rightText} kind={rightDiffKind(row)} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {imageCompare ? (
            <div className={compareStyles.imageGrid}>
              <div className={compareStyles.imagePane}>
                <span className={compareStyles.imageMeta}>Left · {imageCompare.left.mimeType} · {formatBytes(imageCompare.left.byteLength)}</span>
                <span className={compareStyles.imageFrame}>
                  <img className={compareStyles.imagePreview} src={imageCompare.left.src} alt="Left file preview" />
                </span>
              </div>
              <div className={compareStyles.imagePane}>
                <span className={compareStyles.imageMeta}>Right · {imageCompare.right.mimeType} · {formatBytes(imageCompare.right.byteLength)}</span>
                <span className={compareStyles.imageFrame}>
                  <img className={compareStyles.imagePreview} src={imageCompare.right.src} alt="Right file preview" />
                </span>
              </div>
            </div>
          ) : null}
          {folderResult ? (
            <>
              <div className={compareStyles.result}>
                <strong>{folderResult.message}</strong>
                <span>{changedRows.length} changed, {folderResult.rows.length - changedRows.length} same.</span>
              </div>
              {changedRows.length === 0 ? <div className={compareStyles.empty}>No folder differences found.</div> : (
                <div className={compareStyles.rowList}>
                  {changedRows.slice(0, 250).map((row) => (
                    <div className={compareStyles.row} key={`${row.disposition}:${row.relativePath}`}>
                      <span className={compareStyles.rowPath} title={row.relativePath}>{row.relativePath}</span>
                      <span className={compareStyles.rowMeta}>{row.disposition.replace(/_/g, " ")}</span>
                      <span className={compareStyles.rowMeta}>{formatBytes(row.leftSize ?? null)} / {formatBytes(row.rightSize ?? null)}</span>
                      <span className={compareStyles.rowActions}>
                        {row.leftSize != null ? <button className={compareStyles.miniButton} type="button" onClick={() => void queueFolderCopy(row, "left_to_right")}>Copy R</button> : null}
                        {row.rightSize != null ? <button className={compareStyles.miniButton} type="button" onClick={() => void queueFolderCopy(row, "right_to_left")}>Copy L</button> : null}
                        {row.leftSize != null ? <button className={compareStyles.miniButton} type="button" onClick={() => void queueFolderDelete(row, "left")}>Trash L</button> : null}
                        {row.rightSize != null ? <button className={compareStyles.miniButton} type="button" onClick={() => void queueFolderDelete(row, "right")}>Trash R</button> : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className={dialogStyles.actions}>
          <button className={dialogStyles.actionButton} type="button" onClick={props.onClose}>Close</button>
          <button className={dialogStyles.actionButton} type="submit" disabled={running}>{running ? "Comparing" : "Compare"}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function CompareDiffLine(props: {
  lineNumber: number | null;
  text: string;
  kind: CompareTextDiffKind;
}) {
  return (
    <span className={cx(compareStyles.diffLine, diffLineStyle(props.kind))}>
      <span className={compareStyles.diffLineNumber}>{props.lineNumber ?? ""}</span>
      <span className={compareStyles.diffText}>{props.text || " "}</span>
    </span>
  );
}

function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

function joinLocalPath(root: string, relativePath: string) {
  const normalizedRoot = root.replace(/\/+$/, "");
  const normalizedRelative = relativePath.replace(/^\/+/, "");
  return normalizedRoot === "/" ? `/${normalizedRelative}` : `${normalizedRoot}/${normalizedRelative}`;
}

async function loadCompareTextDiff(leftPath: string, rightPath: string): Promise<CompareTextDiffState | null> {
  try {
    const [leftText, rightText] = await Promise.all([
      previewTextForCompare(leftPath),
      previewTextForCompare(rightPath),
    ]);
    if (leftText == null || rightText == null) return null;
    return buildCompareTextDiff(leftText, rightText);
  } catch {
    return null;
  }
}

async function loadCompareImagePreview(leftPath: string, rightPath: string): Promise<CompareImageState | null> {
  try {
    const [left, right] = await Promise.all([
      previewImageForCompare(leftPath),
      previewImageForCompare(rightPath),
    ]);
    if (!left || !right) return null;
    return { left, right };
  } catch {
    return null;
  }
}

async function previewTextForCompare(path: string): Promise<string | null> {
  const payload = await explorerPreviewItem(path);
  if (!comparePreviewIsText(payload.mimeType)) return null;
  return new TextDecoder("utf-8").decode(Uint8Array.from(payload.bytes));
}

async function previewImageForCompare(path: string): Promise<CompareImagePreview | null> {
  const payload = await explorerPreviewItem(path);
  if (!payload.mimeType.toLowerCase().startsWith("image/")) return null;
  return {
    src: `data:${payload.mimeType};base64,${base64FromBytes(payload.bytes)}`,
    mimeType: payload.mimeType,
    byteLength: payload.bytes.length,
  };
}

function comparePreviewIsText(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("text/")
    || normalized.includes("json")
    || normalized.includes("xml")
    || normalized.includes("javascript")
    || normalized.includes("typescript");
}

function base64FromBytes(bytes: number[]): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return window.btoa(binary);
}

function buildCompareTextDiff(leftText: string, rightText: string): CompareTextDiffState {
  const leftAll = splitCompareLines(leftText);
  const rightAll = splitCompareLines(rightText);
  const truncated = leftAll.length > 800 || rightAll.length > 800;
  const leftLines = leftAll.slice(0, 800);
  const rightLines = rightAll.slice(0, 800);
  const lcs = Array.from({ length: leftLines.length + 1 }, () => new Uint16Array(rightLines.length + 1));
  for (let left = leftLines.length - 1; left >= 0; left -= 1) {
    for (let right = rightLines.length - 1; right >= 0; right -= 1) {
      lcs[left][right] = leftLines[left] === rightLines[right]
        ? lcs[left + 1][right + 1] + 1
        : Math.max(lcs[left + 1][right], lcs[left][right + 1]);
    }
  }
  const rows: CompareTextDiffRow[] = [];
  let left = 0;
  let right = 0;
  while (left < leftLines.length || right < rightLines.length) {
    if (left < leftLines.length && right < rightLines.length && leftLines[left] === rightLines[right]) {
      rows.push(compareTextRow(rows.length, left + 1, right + 1, leftLines[left], rightLines[right], "same"));
      left += 1;
      right += 1;
    } else if (right >= rightLines.length || (left < leftLines.length && lcs[left + 1][right] >= lcs[left][right + 1])) {
      if (right < rightLines.length) {
        rows.push(compareTextRow(rows.length, left + 1, right + 1, leftLines[left], rightLines[right], "changed"));
        left += 1;
        right += 1;
      } else {
        rows.push(compareTextRow(rows.length, left + 1, null, leftLines[left], "", "removed"));
        left += 1;
      }
    } else {
      rows.push(compareTextRow(rows.length, null, right + 1, "", rightLines[right], "added"));
      right += 1;
    }
  }
  return { leftText, rightText, rows, truncated };
}

function splitCompareLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function compareTextRow(
  index: number,
  leftLine: number | null,
  rightLine: number | null,
  leftText: string,
  rightText: string,
  kind: CompareTextDiffKind,
): CompareTextDiffRow {
  return {
    id: `${index}:${leftLine ?? ""}:${rightLine ?? ""}`,
    leftLine,
    rightLine,
    leftText,
    rightText,
    kind,
  };
}

function leftDiffKind(row: CompareTextDiffRow): CompareTextDiffKind {
  return row.kind === "added" ? "changed" : row.kind;
}

function rightDiffKind(row: CompareTextDiffRow): CompareTextDiffKind {
  return row.kind === "removed" ? "changed" : row.kind;
}

function diffLineStyle(kind: CompareTextDiffKind): string {
  if (kind === "added") return compareStyles.diffAdded;
  if (kind === "removed") return compareStyles.diffRemoved;
  if (kind === "changed") return compareStyles.diffChanged;
  return compareStyles.diffSame;
}
