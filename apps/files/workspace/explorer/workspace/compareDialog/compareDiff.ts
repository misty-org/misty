import type {
  CompareTextDiffRow,
  CompareTextDiffState,
} from "../../model/interfaces/workspace/ExplorerCompareDialog";
import type { CompareTextDiffKind } from "../../model/types/workspace/ExplorerCompareDialog";
import { compareStyles } from "../ExplorerDesktopDialogStyles";

export function buildCompareTextDiff(leftText: string, rightText: string): CompareTextDiffState {
  const leftAll = splitCompareLines(leftText);
  const rightAll = splitCompareLines(rightText);
  const truncated = leftAll.length > 800 || rightAll.length > 800;
  const leftLines = leftAll.slice(0, 800);
  const rightLines = rightAll.slice(0, 800);
  const lcs = Array.from(
    { length: leftLines.length + 1 },
    () => new Uint16Array(rightLines.length + 1),
  );
  for (let left = leftLines.length - 1; left >= 0; left -= 1) {
    for (let right = rightLines.length - 1; right >= 0; right -= 1) {
      lcs[left][right] =
        leftLines[left] === rightLines[right]
          ? lcs[left + 1][right + 1] + 1
          : Math.max(lcs[left + 1][right], lcs[left][right + 1]);
    }
  }
  const rows: CompareTextDiffRow[] = [];
  let left = 0;
  let right = 0;
  while (left < leftLines.length || right < rightLines.length) {
    if (
      left < leftLines.length &&
      right < rightLines.length &&
      leftLines[left] === rightLines[right]
    ) {
      rows.push(
        compareTextRow(
          rows.length,
          left + 1,
          right + 1,
          leftLines[left],
          rightLines[right],
          "same",
        ),
      );
      left += 1;
      right += 1;
    } else if (
      right >= rightLines.length ||
      (left < leftLines.length && lcs[left + 1][right] >= lcs[left][right + 1])
    ) {
      if (right < rightLines.length) {
        rows.push(
          compareTextRow(
            rows.length,
            left + 1,
            right + 1,
            leftLines[left],
            rightLines[right],
            "changed",
          ),
        );
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

export function splitCompareLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function compareTextRow(
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

export function leftDiffKind(row: CompareTextDiffRow): CompareTextDiffKind {
  return row.kind === "added" ? "changed" : row.kind;
}

export function rightDiffKind(row: CompareTextDiffRow): CompareTextDiffKind {
  return row.kind === "removed" ? "changed" : row.kind;
}

export function diffLineStyle(kind: CompareTextDiffKind): string {
  if (kind === "added") return compareStyles.diffAdded;
  if (kind === "removed") return compareStyles.diffRemoved;
  if (kind === "changed") return compareStyles.diffChanged;
  return compareStyles.diffSame;
}
