import {
  Armchair,
  BookOpen,
  Bot,
  Coffee,
  GlassWater,
  Lamp,
  Minus,
  Monitor,
  Plus,
  Presentation,
  RectangleHorizontal,
  RotateCw,
  Sofa,
  Sprout,
  Table,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button, IconButton, OptionSelect } from "@/shared/ui";
import { furniture, furnitureKinds, type FurnitureKind } from "./studio/catalog";
import { ROOM } from "./studio/grid";
import {
  addItem,
  assignDesk,
  removeItem,
  resizeRoom,
  rotateItem,
  type StudioLayout,
} from "./studio/layout";
import type { StudioAgent } from "./useStudioAgents";

const icons: Record<FurnitureKind, LucideIcon> = {
  desk: Monitor,
  sofa: Sofa,
  armchair: Armchair,
  table: Table,
  "coffee-table": Coffee,
  bookshelf: BookOpen,
  screen: Presentation,
  plant: Sprout,
  lamp: Lamp,
  cooler: GlassWater,
  rug: RectangleHorizontal,
};

/**
 * The room's own size: wider or deeper a few cells at a time, up to the largest studio, and
 * smaller again as long as no furniture would be left outside the walls.
 */
function RoomSizer(props: { layout: StudioLayout; onLayout(next: StudioLayout): void }) {
  const { layout } = props;
  const sides = [
    { label: "Width", key: "w", value: layout.size.w },
    { label: "Depth", key: "d", value: layout.size.d },
  ] as const;
  return (
    <div className="virtual-studio-room" role="group" aria-label="Room size">
      {sides.map(({ label, key, value }) => {
        const smaller = resizeRoom(layout, { [key]: -ROOM.step });
        const bigger = resizeRoom(layout, { [key]: ROOM.step });
        return (
          <div key={key} className="virtual-studio-room-row">
            <span className="flex-1 text-ui text-cream-muted">{label}</span>
            <IconButton
              label={`Less ${label.toLowerCase()}`}
              size="sm"
              disabled={smaller === layout}
              onClick={() => props.onLayout(smaller)}
            >
              <Minus aria-hidden="true" />
            </IconButton>
            <span className="w-6 text-center text-ui tabular-nums text-cream">{value}</span>
            <IconButton
              label={`More ${label.toLowerCase()}`}
              size="sm"
              disabled={bigger === layout}
              onClick={() => props.onLayout(bigger)}
            >
              <Plus aria-hidden="true" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Build mode's controls: a palette that adds a piece of furniture to the room, and, for the piece
 * that is picked, turning it, removing it and, for a desk, choosing whose it is. Moving is done by
 * dragging the piece in the room itself.
 */
export function BuildPanel(props: {
  layout: StudioLayout;
  agents: StudioAgent[];
  picked: string | null;
  onPick(id: string | null): void;
  onLayout(next: StudioLayout): void;
  onReset(): void;
}) {
  const { layout } = props;
  const picked = layout.items.find((item) => item.id === props.picked);
  const add = (kind: FurnitureKind) => {
    const added = addItem(layout, kind);
    if (!added) return;
    props.onLayout(added.layout);
    props.onPick(added.id);
  };
  return (
    <>
      <aside className="virtual-studio-palette" aria-label="Furniture">
        {furnitureKinds.map((kind) => {
          const Icon = icons[kind];
          return (
            <Button
              key={kind}
              variant="quiet"
              justify="start"
              onClick={() => add(kind)}
              icon={Icon}
            >
              <span className="flex-1 text-left">{furniture[kind].label}</span>
              <Plus aria-hidden="true" className="size-3.5 opacity-60" />
            </Button>
          );
        })}
        <RoomSizer layout={layout} onLayout={props.onLayout} />
        <Button className="mt-1" onClick={props.onReset}>
          Reset layout
        </Button>
      </aside>
      {picked ? (
        <div
          className="virtual-studio-piece"
          role="toolbar"
          aria-label={furniture[picked.kind].label}
        >
          <span className="px-1 text-sm font-medium text-cream-bright">
            {furniture[picked.kind].label}
          </span>
          {picked.kind === "desk" ? (
            <OptionSelect
              aria-label="Whose desk"
              className="h-8 w-44"
              value={picked.agent ?? ""}
              options={[
                { value: "", label: "Anyone", icon: Users },
                ...props.agents.map(({ agent }) => ({
                  value: agent.id,
                  label: agent.name,
                  icon: Bot,
                })),
              ]}
              onValueChange={(agent) =>
                props.onLayout(assignDesk(layout, picked.id, agent || null))
              }
            />
          ) : null}
          <IconButton label="Turn" onClick={() => props.onLayout(rotateItem(layout, picked.id))}>
            <RotateCw aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Remove"
            onClick={() => {
              props.onLayout(removeItem(layout, picked.id));
              props.onPick(null);
            }}
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
    </>
  );
}
