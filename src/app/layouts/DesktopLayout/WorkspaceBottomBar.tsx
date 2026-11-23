import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WorkspaceView } from "@/features/app-windows";
import { BottomBar, CustomizableBar, type BarItem, type BarLayout } from "@misty/ui";
import { BottomBarOpenContext, bottomBarItems } from "./BottomBarItems";
import {
  bottomBarDefaults,
  bottomBarItemIds,
  useBottomBar,
  type BottomBarItemId,
} from "./bottom_bar_store";
import { closedHeight } from "./space_bar_timing";

type Side = "start" | "end";

const items = Object.fromEntries(
  bottomBarItemIds.map((id) => {
    const { label, Item } = bottomBarItems[id];
    return [id, { label, node: <Item /> }];
  }),
) as Record<BottomBarItemId, BarItem>;

const homeSide = (id: BottomBarItemId): Side =>
  bottomBarDefaults.start.includes(id) ? "start" : "end";

export function WorkspaceBottomBar(props: {
  gridColumn: number;
  onOpen(view: WorkspaceView): void;
}) {
  const { start, end } = useBottomBar(
    useShallow((state) => ({ start: state.start, end: state.end })),
  );
  useEffect(() => void useBottomBar.getState().load(), []);
  const hidden = bottomBarItemIds.filter((id) => !start.includes(id) && !end.includes(id));
  const layoutOf = (side: Side): BarLayout => {
    const shown = side === "start" ? start : end;
    const off = hidden.filter((id) => homeSide(id) === side);
    return { order: [...shown, ...off], hidden: off };
  };
  const save = (side: Side, next: BarLayout) => {
    const shown = next.order.filter((id) => !next.hidden.includes(id)) as BottomBarItemId[];
    useBottomBar.getState().set(side === "start" ? { start: shown, end } : { start, end: shown });
  };
  const bar = (side: Side) => (
    <CustomizableBar
      label={side === "start" ? "Window bar start" : "Window bar end"}
      axis="x"
      items={items}
      layout={layoutOf(side)}
      onChange={(next) => save(side, next)}
      onReset={() => useBottomBar.getState().reset()}
      className={side === "start" ? "min-w-0 flex-1 gap-2 self-stretch" : "gap-2 self-stretch"}
    />
  );
  return (
    <BottomBarOpenContext.Provider value={props.onOpen}>
      <div
        className="[--ui-bottom-bar-standard:var(--ui-header)]"
        style={{ gridColumn: props.gridColumn, gridRow: 4, paddingBottom: closedHeight }}
      >
        <BottomBar aria-label="Window bar" size="standard" start={bar("start")}>
          {bar("end")}
        </BottomBar>
      </div>
    </BottomBarOpenContext.Provider>
  );
}
