import { X } from "lucide-react";
import { useEffect, useId, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsRow as Row } from "@/features/settings";
import { usePointerReorder } from "@misty/ui";
import { Button, cn, IconButton, Pressable, Surface, Text, Tooltip } from "@misty/ui";
import { bottomBarItems } from "./BottomBarItems";
import {
  bottomBarDefaults,
  bottomBarItemIds,
  useBottomBar,
  type BottomBarItemId,
} from "./bottom_bar_store";

type Zone = "start" | "end" | "hidden";

export function BottomBarSettings() {
  const { start, end } = useBottomBar(
    useShallow((state) => ({ start: state.start, end: state.end })),
  );
  useEffect(() => void useBottomBar.getState().load(), []);
  const hidden = bottomBarItemIds.filter((id) => !start.includes(id) && !end.includes(id));
  const scope = useId();
  const isDefault =
    start.join() === bottomBarDefaults.start.join() && end.join() === bottomBarDefaults.end.join();

  const move = (id: BottomBarItemId, zone: Zone, target = "", after = true) => {
    const next = {
      start: start.filter((other) => other !== id),
      end: end.filter((other) => other !== id),
    };
    if (zone !== "hidden") {
      const list = next[zone];
      const at = list.indexOf(target as BottomBarItemId);
      list.splice(at < 0 ? list.length : at + (after ? 1 : 0), 0, id);
    }
    useBottomBar.getState().set(next);
  };
  const show = (id: BottomBarItemId) => move(id, bottomBarItems[id].side);

  return (
    <>
      <Row
        label="Bar"
        description="Drag items between its ends: left for the whole window, right for the page in view."
        stacked
      >
        <Surface
          tone="well"
          edge="hairline"
          radius="lg"
          className="flex min-w-0 items-center gap-2 p-1"
        >
          <ZoneList zone="start" ids={start} scope={scope} onMove={move} empty="Drag items here" />
          <ZoneList zone="end" ids={end} scope={scope} onMove={move} empty="Drag items here" />
        </Surface>
      </Row>
      <Row label="More items" description="Click one to add it, or drag it into the bar." stacked>
        <ZoneList
          zone="hidden"
          ids={hidden}
          scope={scope}
          onMove={move}
          onShow={show}
          empty="Everything is in the bar"
        />
      </Row>
      {isDefault ? null : (
        <Row
          label="Default layout"
          description="Agent activity and the server on the left; the branch, zoom, shortcuts and page info on the right."
        >
          <Button variant="secondary" onClick={() => useBottomBar.getState().reset()}>
            Reset
          </Button>
        </Row>
      )}
    </>
  );
}

function ZoneList(props: {
  zone: Zone;
  ids: BottomBarItemId[];
  scope: string;
  empty: string;
  onMove(id: BottomBarItemId, zone: Zone, target?: string, after?: boolean): void;
  onShow?(id: BottomBarItemId): void;
}) {
  const { zone, ids, onMove } = props;
  const nudge = (id: BottomBarItemId, direction: -1 | 1) => {
    const target = ids[ids.indexOf(id) + direction];
    if (!target || zone === "hidden") return;
    onMove(id, zone, target, direction === 1);
  };
  const reorder = usePointerReorder({
    scope: props.scope,
    axis: "x",
    getDrag: (id) => ({ id, label: bottomBarItems[id as BottomBarItemId]?.label ?? id }),
    onDrop: (drag, target, after) => onMove(drag.id as BottomBarItemId, zone, target, after),
    onKeyboardMove: (id, direction) => nudge(id as BottomBarItemId, direction),
  });
  const onKeyDown = (id: BottomBarItemId) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    nudge(id, event.key === "ArrowLeft" ? -1 : 1);
  };
  const label = zone === "start" ? "Left end" : zone === "end" ? "Right end" : "More items";
  return (
    <div
      {...reorder}
      role="list"
      aria-label={label}
      className={cn(
        zone === "hidden"
          ? "grid min-h-10 grid-cols-[repeat(auto-fill,minmax(--spacing(48),1fr))] gap-1"
          : "flex min-h-10 min-w-0 flex-1 items-center gap-1 overflow-x-auto",
        zone === "end" && "justify-end",
      )}
    >
      {props.ids.map((id) => {
        const { label: name, icon: Icon, description } = bottomBarItems[id];
        const body = (
          <>
            <Text bare tone="muted" className="inline-flex shrink-0">
              <Icon aria-hidden="true" />
            </Text>
            <Text bare tone="default" className="whitespace-nowrap">
              {name}
            </Text>
          </>
        );
        return (
          <Surface
            key={id}
            role="listitem"
            tone="card"
            edge="hairline"
            radius="md"
            data-reorder-item={id}
            data-reorder-handle=""
            data-reorder-preview=""
            className="flex h-8 shrink-0 cursor-grab items-center active:cursor-grabbing"
          >
            {zone === "hidden" ? (
              <Tooltip content={description}>
                <Pressable
                  wash="control"
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2"
                  aria-label={`Add ${name} to the bar`}
                  onClick={() => props.onShow?.(id)}
                >
                  {body}
                </Pressable>
              </Tooltip>
            ) : (
              <span
                tabIndex={0}
                aria-label={`${name}. Arrow keys move it along the bar.`}
                onKeyDown={onKeyDown(id)}
                className="flex h-full items-center gap-2 pr-0.5 pl-2 outline-none"
              >
                {body}
                <IconButton
                  size="sm"
                  data-reorder-ignore=""
                  label={`Remove ${name} from the bar`}
                  onClick={() => onMove(id, "hidden")}
                >
                  <X />
                </IconButton>
              </span>
            )}
          </Surface>
        );
      })}
      {props.ids.length ? null : (
        <Text size="meta" tone="muted" className="px-2">
          {props.empty}
        </Text>
      )}
    </div>
  );
}
