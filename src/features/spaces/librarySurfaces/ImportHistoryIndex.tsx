import { History } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { formatBytes, formatTime } from "../libraryFormat";
import { BackToCollections, LibraryNothingHere } from "./LibraryNothingHere";

const cardClass = "rounded-xl bg-card p-4 shadow-xs inset-ring-1 inset-ring-foreground/10";

/** Library transfers in and out of this Space. */
export function ImportHistoryIndex() {
  const { data } = useSpaceLibraryContext();
  if (data.collection !== "imports") return null;

  return (
    <div className="mb-5">
      <BackToCollections />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {data.importHistory.map((entry) => (
          <article className={cardClass} key={entry.id}>
            <div className="flex items-center justify-between gap-3">
              <History size={20} />
              <span className="rounded-lg bg-muted px-2 py-1 text-[10px] capitalize text-muted-foreground">
                {entry.direction}
              </span>
            </div>
            <p className="mb-0 mt-3 truncate text-xs font-medium">{entry.display_name}</p>
            <p className="mb-0 mt-1 truncate text-[10px] text-muted-foreground">
              {entry.direction === "incoming" ? "From" : "To"} {entry.counterpart_space_name}
            </p>
            <p className="mb-0 mt-3 text-[10px] text-muted-foreground">
              {formatBytes(entry.logical_bytes)} ·{" "}
              {formatTime(entry.completed_at ?? entry.created_at)} · {entry.state}
            </p>
          </article>
        ))}
      </div>
      {data.importHistory.length === 0 ? <LibraryNothingHere /> : null}
    </div>
  );
}
