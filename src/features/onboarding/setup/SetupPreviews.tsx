import type { TabSide } from "@/app/shell/dockingLayout";
import { Surface } from "@/shared/ui";

/** A tiny window with the tab sidebar on one side and a page beside it. */
export function TabsPreview(props: { side: TabSide }) {
  return (
    <Surface
      tone="card"
      edge="hairline"
      radius="md"
      className={`flex aspect-[16/10] w-full gap-[4%] overflow-hidden p-[5%] ${
        props.side === "right" ? "flex-row-reverse" : ""
      }`}
    >
      <div className="flex w-[26%] flex-col gap-[6%]">
        <Surface tone="active" className="h-[12%] rounded-sm" />
        <Surface tone="well" className="h-[12%] rounded-sm" />
        <Surface tone="well" className="h-[12%] rounded-sm" />
      </div>
      <Surface
        tone="page"
        edge="hairline"
        className="flex flex-1 flex-col gap-[8%] rounded-sm p-[8%]"
      >
        <Surface tone="well" className="h-[8%] w-1/2 rounded-sm" />
        <Surface tone="well" className="h-[8%] w-3/4 rounded-sm" />
      </Surface>
    </Surface>
  );
}
