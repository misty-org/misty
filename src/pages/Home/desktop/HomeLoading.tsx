const skeletonBlockClass = "misty-skeleton rounded-md";
const tileClass =
  "min-h-[10rem] rounded-2xl border border-white/[0.08] bg-[#090c10]/78 p-4 shadow-xl shadow-black/20";

export function HomeLoading() {
  return (
    <div className="misty-scrollbar box-border h-full min-h-0 overflow-x-hidden overflow-y-scroll overscroll-contain p-5">
      <section className="mx-auto grid min-h-full w-full max-w-[1500px] auto-rows-min gap-4 xl:h-full xl:min-h-[680px] xl:grid-cols-12 xl:grid-rows-7 xl:auto-rows-fr">
        <LoadingTile className="xl:col-span-4 xl:col-start-1 xl:row-span-3 xl:row-start-1" lines={4} />
        <LoadingTile className="xl:col-span-4 xl:col-start-5 xl:row-span-4 xl:row-start-1" lines={6} />
        <LoadingTile className="xl:col-span-4 xl:col-start-9 xl:row-span-3 xl:row-start-1" lines={4} />
        <LoadingTile className="xl:col-span-4 xl:col-start-1 xl:row-span-3 xl:row-start-4" lines={4} />
        <LoadingTile className="xl:col-span-4 xl:col-start-5 xl:row-span-2 xl:row-start-5" lines={2} />
        <LoadingTile className="xl:col-span-4 xl:col-start-9 xl:row-span-3 xl:row-start-4" lines={3} />
        <footer className={`${tileClass} grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:col-span-12 xl:col-start-1 xl:row-start-7`}>
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
