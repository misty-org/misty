const shimmer = "relative animate-pulse overflow-hidden rounded-md bg-charcoal-hover";

const rows = Array.from({ length: 10 }, (_, index) => index);
const sidebarRows = Array.from({ length: 7 }, (_, index) => index);

export function ExplorerLoadingShell() {
  return (
    <section
      className="grid h-full min-h-0 grid-rows-[46px_72px_minmax(0,1fr)_26px] overflow-hidden bg-charcoal-sidebar"
      aria-busy="true"
      aria-label="Loading File Explorer"
    >
      <div className="flex min-w-0 items-center gap-3 border-b border-charcoal-border px-3">
        <span className={`${shimmer} h-7 w-36`} />
        <span className={`${shimmer} h-7 w-24 opacity-65`} />
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-charcoal-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`${shimmer} size-8`} />
          <span className={`${shimmer} size-8`} />
          <span className={`${shimmer} h-9 w-[min(520px,55vw)]`} />
        </div>
        <span className={`${shimmer} h-9 w-44 max-[760px]:hidden`} />
      </div>

      <div className="grid min-h-0 min-w-0 grid-cols-[260px_1px_minmax(0,1fr)_1px_280px] overflow-hidden max-[980px]:grid-cols-[minmax(0,1fr)]">
        <aside className="grid min-h-0 content-start gap-3 overflow-hidden p-4 max-[980px]:hidden">
          <span className={`${shimmer} mb-1 h-3 w-20`} />
          {sidebarRows.map((index) => (
            <span
              className={`${shimmer} h-8 ${index % 3 === 2 ? "w-4/5" : "w-full"}`}
              key={index}
            />
          ))}
        </aside>
        <span className="bg-charcoal-border max-[980px]:hidden" />

        <main className="min-h-0 min-w-0 overflow-hidden">
          <div className="grid min-h-0 min-w-[720px] grid-rows-[40px_repeat(10,36px)] overflow-hidden">
            <div className="grid grid-cols-[minmax(240px,1fr)_220px_128px_128px] items-center gap-4 bg-charcoal-card px-3.5">
              {[0, 1, 2, 3].map((index) => (
                <span className={`${shimmer} h-3`} key={index} />
              ))}
            </div>
            {rows.map((index) => (
              <div
                className="grid grid-cols-[minmax(240px,1fr)_220px_128px_128px] items-center gap-4 px-3.5"
                key={index}
              >
                <span className={`${shimmer} h-4`} />
                <span className={`${shimmer} h-3`} />
                <span className={`${shimmer} h-3`} />
                <span className={`${shimmer} h-3`} />
              </div>
            ))}
          </div>
        </main>

        <span className="bg-charcoal-border max-[980px]:hidden" />
        <aside className="grid min-h-0 content-start gap-4 overflow-hidden p-4 max-[980px]:hidden">
          <span className={`${shimmer} mx-auto size-28 rounded-xl`} />
          <span className={`${shimmer} h-4 w-3/4`} />
          <span className={`${shimmer} h-3 w-full`} />
          <span className={`${shimmer} h-3 w-5/6`} />
        </aside>
      </div>

      <div className="border-t border-charcoal-border" />
    </section>
  );
}
