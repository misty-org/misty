/** Diffs as the native side builds them (src-tauri/crates/agent-code/src/diff.rs). */
interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
  old?: number;
  new?: number;
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
  truncated: boolean;
}

export interface DiffSet {
  files: FileDiff[];
  additions: number;
  deletions: number;
  moreFiles: number;
}
