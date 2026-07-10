const skeletonBlockClass = "misty-skeleton rounded-md";
const tileClass =
  "min-h-fit rounded-2xl border border-white/[0.08] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4 shadow-xl shadow-black/20";

export function HomeLoading() {
  return (
    <div className="misty-scrollbar box-border h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain p-[clamp(0.5rem,1vw,1.25rem)]">
      <section className="flex min-h-full w-full min-w-0 flex-col gap-[clamp(0.5rem,0.8vw,1rem)]">
        <div className="flex min-h-fit min-w-0 flex-auto gap-[clamp(0.5rem,0.8vw,1rem)]">
          <div className="flex min-h-fit min-w-0 flex-1 flex-col gap-[clamp(0.5rem,0.8vw,1rem)]">
            <LoadingTile className="flex-[3_1_auto]" lines={4} />
            <LoadingTile className="flex-[3_1_auto]" lines={4} />
          </div>
          <div className="flex min-h-fit min-w-0 flex-1 flex-col gap-[clamp(0.5rem,0.8vw,1rem)]">
            <LoadingTile className="flex-[4_1_auto]" lines={6} />
            <LoadingTile className="flex-[2_1_auto]" lines={2} />
          </div>
          <div className="flex min-h-fit min-w-0 flex-1 flex-col gap-[clamp(0.5rem,0.8vw,1rem)]">
            <LoadingTile className="flex-[1_1_auto]" lines={4} />
            <LoadingTile className="flex-[1_1_auto]" lines={3} />
          </div>
        </div>
        <footer className={`${tileClass} grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 overflow-hidden`}>
          <div className={`${skeletonBlockClass} h-12`} />
          <div className={`${skeletonBlockClass} h-12`} />
          <div className={`${skeletonBlockClass} h-12 w-64`} />
        </footer>
      </section>
    </div>
  );
}

function LoadingTile({
  className,
  lines,
}: {
  className: string;
  lines: number;
}) {
  return (
    <div className={`${tileClass} ${className}`}>
      <div className={`${skeletonBlockClass} h-5 w-36`} />
      <div className="mt-5 grid gap-3">
        {Array.from({ length: lines }, (_, index) => (
          <div
            className={`${skeletonBlockClass} h-4 ${index % 3 === 0 ? "w-4/5" : index % 3 === 1 ? "w-2/3" : "w-1/2"}`}
            key={index}
          />
        ))}
      </div>
    </div>
  );
}
