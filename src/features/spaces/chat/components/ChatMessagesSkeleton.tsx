import { Skeleton } from "@/shared/ui";

const rows: { name: string; line1: string; line2?: string }[] = [
  { name: "30%", line1: "70%", line2: "45%" },
  { name: "22%", line1: "50%" },
  { name: "26%", line1: "85%", line2: "60%" },
  { name: "20%", line1: "35%" },
];

export function ChatMessagesSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading conversation</span>
      {rows.map((widths, index) => (
        <div className="mb-6 grid grid-cols-[36px_minmax(0,1fr)_32px] gap-3" key={index}>
          <Skeleton className="size-9 rounded-full" />
          <div className="grid min-w-0 gap-2">
            <Skeleton className="h-3.5 rounded" style={{ width: widths.name }} />
            <Skeleton className="h-4 rounded" style={{ width: widths.line1 }} />
            {widths.line2 ? (
              <Skeleton className="h-4 rounded" style={{ width: widths.line2 }} />
            ) : null}
          </div>
          <div />
        </div>
      ))}
    </div>
  );
}
