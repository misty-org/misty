import { createElement } from "react";
import { useScopedSearch } from "@/shared/lib/scopedSearch";
import { useFileIndex } from "../context-panel/files/fileIndex";
import { getFileTreeIconSvg } from "../context-panel/files/fileIcons";
import { searchEntries } from "../context-panel/files/fileSearch";
import { fileName, joinPath, useFilesStore } from "../context-panel/files/filesStore";

/**
 * ⌘P on the Code page: the ⌘K box, scoped to the folder's files under a chip ("misty files"),
 * ranked by name from the folder's index. Backspace on the empty field widens it to everything.
 */
export function openCodeFileSearch(root: string) {
  useFileIndex.getState().ensure(root);
  useScopedSearch.getState().open({
    label: `${fileName(root)} files`,
    placeholder: "Go to file",
    search: (text) => {
      const entries = useFileIndex.getState().byRoot[root]?.entries ?? [];
      return searchEntries(entries, root, root, text)
        .filter((entry) => !entry.isDir)
        .map((entry) => ({
          id: `file:${root}:${entry.rel}`,
          title: entry.name,
          // The folder it sits in, relative to the project.
          detail: entry.rel.slice(0, entry.rel.length - entry.name.length).replace(/\/$/, ""),
          icon: createElement("span", {
            className: "inline-flex",
            "aria-hidden": true,
            dangerouslySetInnerHTML: { __html: getFileTreeIconSvg(entry.name, false) },
          }),
          open: () => void useFilesStore.getState().openFile(joinPath(root, entry.rel)),
        }));
    },
    subscribe: (onChange) =>
      useFileIndex.subscribe((state, previous) => {
        if (state.byRoot[root] !== previous.byRoot[root]) onChange();
      }),
  });
}
