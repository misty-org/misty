import type { CompareTextDiffKind } from "../../model/types/workspace/ExplorerCompareDialog";
import { compareStyles } from "../ExplorerDesktopDialogStyles";
import { diffLineStyle } from "./compareDiff";
export function CompareDiffLine(props: {
  lineNumber: number | null;
  text: string;
  kind: CompareTextDiffKind;
}) {
  return (
    <span className={`${compareStyles.diffLine} ${diffLineStyle(props.kind)}`}>
      <span className={compareStyles.diffLineNumber}>
        {props.lineNumber ?? ""}
      </span>
      <span className={compareStyles.diffText}>{props.text || " "}</span>
    </span>
  );
}

export function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

export function joinLocalPath(root: string, relativePath: string) {
  const normalizedRoot = root.replace(/\/+$/, "");
  const normalizedRelative = relativePath.replace(/^\/+/, "");
  return normalizedRoot === "/"
    ? `/${normalizedRelative}`
    : `${normalizedRoot}/${normalizedRelative}`;
}
