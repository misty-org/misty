import { ArrowLeft, ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ErrorNotification, IconButton, Pressable, Skeleton } from "@/shared/ui";
import { errorText, projectApi, type ProjectEntry } from "./projectApi";

const FileEditor = lazy(() => import("./FileEditor"));

const kinds: [kind: string, endings: string[]][] = [
  [
    "code",
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "rs",
      "go",
      "py",
      "rb",
      "java",
      "c",
      "cpp",
      "h",
      "swift",
      "kt",
      "sh",
    ],
  ],
  ["style", ["css", "scss", "html", "vue", "svelte"]],
  ["data", ["json", "toml", "yaml", "yml", "lock", "csv", "sql", "env"]],
  ["doc", ["md", "mdx", "txt", "pdf"]],
  ["image", ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"]],
];

/** What sort of file a name is, for its icon's color. */
export function fileKind(name: string): string | undefined {
  const ending = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return kinds.find(([, endings]) => endings.includes(ending))?.[0];
}

const rowSkeletons = (
  <div className="grid gap-2 p-3" aria-hidden="true">
    {[40, 56, 48, 36].map((width) => (
      <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
    ))}
  </div>
);

/** One folder's rows, opened one level at a time so a large project never loads at once. */
function Level(props: { path: string; depth: number; onFile(entry: ProjectEntry): void }) {
  const [entries, setEntries] = useState<ProjectEntry[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setEntries(null);
    void projectApi
      .listDir(props.path)
      .then((found) => live && setEntries(found))
      .catch((reason) => live && (setEntries([]), setError(errorText(reason))));
    return () => {
      live = false;
    };
  }, [props.path]);
  if (!entries) return props.depth === 0 ? rowSkeletons : null;
  return (
    <>
      {entries.map((entry) => {
        const expanded = Boolean(open[entry.path]);
        const Chevron = expanded ? ChevronDown : ChevronRight;
        return (
          <div key={entry.path}>
            <Pressable
              type="button"
              className="context-row"
              style={{ paddingLeft: 10 + props.depth * 14 }}
              aria-expanded={entry.isDir ? expanded : undefined}
              onClick={() =>
                entry.isDir ? setOpen({ ...open, [entry.path]: !expanded }) : props.onFile(entry)
              }
            >
              {entry.isDir ? (
                <Chevron size={14} className="shrink-0" aria-hidden="true" />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {entry.isDir ? (
                <Folder size={15} className="context-folder-icon shrink-0" aria-hidden="true" />
              ) : (
                <File
                  size={15}
                  className="context-file-icon shrink-0"
                  data-kind={fileKind(entry.name)}
                  aria-hidden="true"
                />
              )}
              <span className="truncate" data-muted={entry.heavy || undefined}>
                {entry.name}
              </span>
            </Pressable>
            {entry.isDir && expanded ? (
              <Level path={entry.path} depth={props.depth + 1} onFile={props.onFile} />
            ) : null}
          </div>
        );
      })}
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </>
  );
}

/**
 * The folder's files as a tree. Picking a file opens it in an editor in the same panel, with a
 * way back to the tree; saving writes it to the folder.
 */
export function FilesPanel({ folder }: { folder: string }) {
  const [file, setFile] = useState<ProjectEntry | null>(null);
  const back = useCallback(() => setFile(null), []);
  useEffect(() => setFile(null), [folder]);
  if (file)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="context-subhead">
          <IconButton label="Back to files" onClick={back}>
            <ArrowLeft size={16} />
          </IconButton>
          <span className="truncate" title={file.path}>
            {file.name}
          </span>
        </div>
        <Suspense fallback={rowSkeletons}>
          <FileEditor key={file.path} path={file.path} name={file.name} />
        </Suspense>
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1" role="tree" aria-label="Files">
      <Level path={folder} depth={0} onFile={setFile} />
    </div>
  );
}
