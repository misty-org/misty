import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WorkspaceView } from "@/features/app-windows";
import { BottomBar, CustomizableBar, type BarItem, type BarLayout } from "@/shared/ui";
import { BottomBarOpenContext, bottomBarItems } from "./BottomBarItems";
import {
  bottomBarDefaults,
  bottomBarItemIds,
  useBottomBar,
  type BottomBarItemId,
} from "./bottomBarStore";
import { closedHeight } from "./spaceBarTiming";

type Side = "start" | "end";

const items = Object.fromEntries(
  bottomBarItemIds.map((id) => {
    const { label, Item } = bottomBarItems[id];
    return [id, { label, node: <Item /> }];
  }),
) as Record<BottomBarItemId, BarItem>;

/** The end an item goes back to when it's shown again: where it sits by default. */
const homeSide = (id: BottomBarItemId): Side =>
  bottomBarDefaults.start.includes(id) ? "start" : "end";

/**
 * The window's bottom bar, under the panes and beside the sidebar's account row. It keeps room
 * at the bottom of the window so nothing floats over a page's own content, and shows the items
 * the person picked, in their order, at either end: dragged into place there, or hidden and shown
 * again from a right-click on that end, as in Settings › Interface › Bottom bar.
 */
export function WorkspaceBottomBar(props: {
  gridColumn: number;
  /** Opens a page as the tab bar does, for items that open a chat or a new tab. */
  onOpen(view: WorkspaceView): void;
}) {
  const { start, end } = useBottomBar(
    useShallow((state) => ({ start: state.start, end: state.end })),
  );
  useEffect(() => void useBottomBar.getState().load(), []);
  const hidden = bottomBarItemIds.filter((id) => !start.includes(id) && !end.includes(id));
  // Each end is its own bar: what it shows, then what it would show if the person showed it.
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
      // The start fills the bar's free room, so a right-click anywhere on the bar opens a menu.
      className={side === "start" ? "min-w-0 flex-1 gap-2 self-stretch" : "gap-2 self-stretch"}
    />
  );
  // The tab strip's mirror: the header's height, then the window edge the top edge keeps above
  // the tabs, so a control sits as far from the bottom as the tabs' sit from the top.
  return (
    <BottomBarOpenContext.Provider value={props.onOpen}>
      <div style={{ gridColumn: props.gridColumn, gridRow: 4, paddingBottom: closedHeight }}>
        <BottomBar aria-label="Window bar" start={bar("start")}>
          {bar("end")}
        </BottomBar>
      </div>
    </BottomBarOpenContext.Provider>
  );
}
