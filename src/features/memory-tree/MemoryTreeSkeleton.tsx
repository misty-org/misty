import { Skeleton } from "@/shared/ui";

const columns = [1, 4, 3, 5];

/** The tree's shape while it first loads: a Space, its branches, and what hangs off them. */
export function MemoryTreeSkeleton() {
  return (
    <div className="flex h-full items-center justify-center gap-16 p-8" aria-hidden="true">
      {columns.map((rows, column) => (
        <div key={column} className="flex flex-col gap-3.5">
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} className="h-[54px] w-[216px] rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
