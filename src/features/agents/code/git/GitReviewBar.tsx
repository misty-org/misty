import { getChunks, rejectChunk } from "@codemirror/merge";
import { useFilesStore } from "../../context-panel/files/filesStore";
import { Button, Surface, Text } from "@misty/ui";
import { editorCommandsOf } from "../editorCommands";
import { reviewViews, useGitReview } from "./gitReviewStore";

/** Undoes every change still shown, last first so earlier positions stay put. */
function undoAll(path: string) {
  const view = reviewViews.get(path);
  if (!view) return;
  const chunks = getChunks(view.state)?.chunks ?? [];
  for (let index = chunks.length - 1; index >= 0; index -= 1)
    rejectChunk(view, chunks[index].fromB);
}

/** Saves what the review left, when it differs from the file. */
function saveIfChanged(path: string) {
  const view = reviewViews.get(path);
  if (view && useFilesStore.getState().dirtyPaths[path]) editorCommandsOf(view)?.save();
}

/**
 * The bar over a file on the Code page while its changes are shown inline: an agent's edits as
 * they landed, or everything since the last commit. Each change keeps or undoes on its own in the
 * code; here they all go at once, and Done puts the file back to plain editing. A change on disk
 * to a file with unsaved edits waits here too, until the person picks which to keep. It is one of
 * the page's toolbar rows, on the sidebar's color with a hairline under it.
 */
export function GitReviewBar({ path }: { path: string }) {
  const review = useGitReview((state) => state.reviews[path]);
  const comparing = useGitReview((state) => state.comparing[path] ?? false);
  const clash = useGitReview((state) => state.clashes[path]);
  const count = useGitReview((state) => state.counts[path] ?? 0);

  if (clash !== undefined) {
    return (
      <Surface tone="sidebar" className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3 text-meta">
        <Text tone="default" className="min-w-0 flex-1">
          This file changed on disk while you were editing it
        </Text>
        <Button variant="quiet" onClick={() => useGitReview.getState().setClash(path, null)}>
          Keep mine
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            // Their version, with mine up for review against it.
            const view = reviewViews.get(path);
            const mine = view ? view.state.doc.toString() : "";
            const store = useGitReview.getState();
            store.setClash(path, null);
            store.startReview(path, { before: mine, source: "disk" });
            useFilesStore.getState().setFileDirty(path, false);
            void useFilesStore.getState().reloadFile(path);
          }}
        >
          Load theirs
        </Button>
      </Surface>
    );
  }

  if (!review && !comparing) return null;
  const done = () => {
    saveIfChanged(path);
    const store = useGitReview.getState();
    store.endReview(path);
    store.setComparing(path, false);
  };
  const title = review
    ? review.source === "agent"
      ? "An agent changed this file"
      : "This file changed on disk"
    : "Changes since the last commit";
  return (
    <Surface tone="sidebar" className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3 text-meta">
      <Text tone="default" className="min-w-0 flex-1">
        {title}
      </Text>
      {count > 0 ? (
        <Text size="caption" tone="muted" className="flex-none">
          {count === 1 ? "1 change" : `${count} changes`}
        </Text>
      ) : null}
      {count > 0 ? (
        <Button variant="quiet" onClick={() => undoAll(path)}>
          Undo all
        </Button>
      ) : null}
      <Button variant="secondary" onClick={done}>
        Done
      </Button>
    </Surface>
  );
}
