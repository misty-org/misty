import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { DiffSet, FileDiff } from "./diffTypes";
import { Pressable } from "@/shared/ui";
import "./diff.css";

const statusWords: Record<FileDiff["status"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
};

/** +12 −3, in the diff's own colors. */
export function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="misty-diff-counts">
      <span className="misty-diff-plus" aria-label={`${additions} added`}>
        +{additions}
      </span>
      <span className="misty-diff-minus" aria-label={`${deletions} removed`}>
        −{deletions}
      </span>
    </span>
  );
}

function splitPath(path: string) {
  const cut = path.lastIndexOf("/");
  return cut < 0
    ? { folder: "", name: path }
    : { folder: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}

/** One file: a header that opens and closes, then its hunks with old and new line numbers. */
export function DiffFile({ file, defaultOpen = true }: { file: FileDiff; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { folder, name } = splitPath(file.path);
  return (
    <section className="misty-diff-file" data-status={file.status}>
      <Pressable
        className="misty-diff-file-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={14} aria-hidden="true" className="misty-diff-chevron" />
        <span className="misty-diff-path" title={file.path}>
          <span className="misty-diff-folder">{folder}</span>
          {name}
        </span>
        <span className="misty-diff-status">
          {file.oldPath ? `Renamed from ${file.oldPath}` : statusWords[file.status]}
        </span>
        <DiffCounts additions={file.additions} deletions={file.deletions} />
      </Pressable>
      {open ? (
        file.binary ? (
          <p className="misty-diff-note">Binary file; not shown.</p>
        ) : file.hunks.length ? (
          <div className="misty-diff-body" role="table" aria-label={`Changes to ${file.path}`}>
            {file.hunks.map((hunk) => (
              <div key={`${hunk.oldStart}:${hunk.newStart}`} role="rowgroup">
                <div className="misty-diff-hunk" role="row">
                  <span role="cell">
                    @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                  </span>
                </div>
                {hunk.lines.map((line, index) => (
                  <div
                    key={index}
                    className="misty-diff-line"
                    data-kind={line.kind}
                    role="row"
                    aria-label={
                      line.kind === "add" ? "Added" : line.kind === "del" ? "Removed" : undefined
                    }
                  >
                    <span className="misty-diff-number" role="cell">
                      {line.old ?? ""}
                    </span>
                    <span className="misty-diff-number" role="cell">
                      {line.new ?? ""}
                    </span>
                    <span className="misty-diff-sign" role="cell" aria-hidden="true">
                      {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                    </span>
                    <span className="misty-diff-code" role="cell">
                      {line.text || " "}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {file.truncated ? (
              <p className="misty-diff-note">Long diff; the rest isn't shown.</p>
            ) : null}
          </div>
        ) : (
          <p className="misty-diff-note">
            {file.status === "added"
              ? "Empty file."
              : "No line changes (permissions or line endings)."}
          </p>
        )
      ) : null}
    </section>
  );
}

/** Every file in a diff. Files open by default while the diff is small. */
export function DiffView({ set, openLimit = 400 }: { set: DiffSet; openLimit?: number }) {
  const lines = set.files.reduce(
    (sum, file) => sum + file.hunks.reduce((count, hunk) => count + hunk.lines.length, 0),
    0,
  );
  if (!set.files.length) return <p className="misty-diff-note">No changes.</p>;
  return (
    <div className="misty-diff">
      {set.files.map((file) => (
        <DiffFile key={file.path} file={file} defaultOpen={lines <= openLimit} />
      ))}
      {set.moreFiles ? (
        <p className="misty-diff-note">
          {set.moreFiles} more {set.moreFiles === 1 ? "file" : "files"} changed.
        </p>
      ) : null}
    </div>
  );
}
