import type { Thread } from "../types";
import ThreadRow from "./ThreadRow";

export default function ThreadList({
  threads,
  onSelect,
}: {
  threads: Thread[];
  onSelect: (thread: Thread) => void;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {threads.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-text-muted">No threads found.</p>
        </div>
      ) : (
        threads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            onClick={() => onSelect(thread)}
          />
        ))
      )}
    </div>
  );
}
