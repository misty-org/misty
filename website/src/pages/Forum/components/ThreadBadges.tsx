import { categoryBadge, categoryLabel } from "../data";
import type { Thread } from "../types";

/** Pinned / solved / category chips shown above a thread title. */
export default function ThreadBadges({ thread }: { thread: Thread }) {
  return (
    <>
      {thread.pinned && (
        <span className="text-[10px] font-semibold tracking-[0.14em] text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
          Pinned
        </span>
      )}
      {thread.solved && (
        <span className="text-[10px] font-semibold tracking-[0.14em] text-success bg-success/10 px-1.5 py-0.5 rounded border border-success/20">
          Solved
        </span>
      )}
      <span
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${categoryBadge[thread.category]}`}
      >
        {categoryLabel[thread.category]}
      </span>
    </>
  );
}
