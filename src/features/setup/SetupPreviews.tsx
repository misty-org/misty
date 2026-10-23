import type { TabSide } from "@/features/app-shell/dockingLayout";

/** A tiny window with the tab sidebar on one side and a page beside it. */
export function TabsPreview(props: { side: TabSide }) {
  return (
    <div
      className={`flex aspect-[16/10] w-full gap-[4%] overflow-hidden rounded-md border border-charcoal-border bg-charcoal-card p-[5%] ${
        props.side === "right" ? "flex-row-reverse" : ""
      }`}
    >
      <div className="flex w-[26%] flex-col gap-[6%]">
        <div className="h-[12%] rounded-sm bg-charcoal-active" />
        <div className="h-[12%] rounded-sm bg-charcoal-hover" />
        <div className="h-[12%] rounded-sm bg-charcoal-hover" />
      </div>
      <div className="flex flex-1 flex-col gap-[8%] rounded-sm border border-charcoal-border bg-charcoal-bg p-[8%]">
        <div className="h-[8%] w-1/2 rounded-sm bg-charcoal-hover" />
        <div className="h-[8%] w-3/4 rounded-sm bg-charcoal-hover" />
      </div>
    </div>
  );
}
