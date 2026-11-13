import { Skeleton, cn } from "@/shared/ui";

/** Each placeholder message: its name's width, then the width of each 24px body line. */
const rows: { name: string; lines: string[] }[] = [
  { name: "w-28", lines: ["w-3/4", "w-1/2"] },
  { name: "w-20", lines: ["w-2/3"] },
  { name: "w-24", lines: ["w-5/6", "w-3/5"] },
  { name: "w-16", lines: ["w-2/5"] },
];

/**
 * A chat's first messages while they load, shaped like `ChatMessageRow`: the 40px avatar in its
 * 44px column, the name line, and 24px body lines, with the rows' own spacing. `framed` adds the
 * message scroller's padding, for where the scroller isn't there yet.
 */
export function ChatMessagesSkeleton({ framed = false }: { framed?: boolean }) {
  return (
    <div
      aria-busy="true"
      role="status"
      className={cn(
        framed && "min-h-0 flex-1 overflow-hidden px-[clamp(16px,2.5vw,32px)] pb-3 pt-4",
      )}
    >
      <span className="sr-only">Loading conversation</span>
      {rows.map((row, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="mt-4 grid min-h-10 grid-cols-[44px_minmax(0,1fr)] gap-x-4 py-1 first:mt-0"
        >
          <Skeleton className="mt-0.5 size-10 justify-self-end rounded-full" />
          <div className="min-w-0">
            <div className="flex h-5 items-center gap-2">
              <Skeleton className={cn("h-3.5", row.name)} />
              <Skeleton className="h-2.5 w-10" />
            </div>
            {row.lines.map((width, line) => (
              <div key={line} className="flex h-6 items-center">
                <Skeleton className={cn("h-3.5", width)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
