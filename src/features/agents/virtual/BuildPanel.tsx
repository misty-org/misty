import { AgentAvatar } from "../personal/AgentAvatar";
import {
  Armchair,
  BookOpen,
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
import { Button, IconButton, OptionSelect, Separator, Surface, Text } from "@/shared/ui";
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
    <div className="mt-1 grid" role="group" aria-label="Room size">
      <Separator />
      <div className="grid gap-0.5 pt-1.5 pr-1 pb-0.5 pl-2.5">
        {sides.map(({ label, key, value }) => {
          const smaller = resizeRoom(layout, { [key]: -ROOM.step });
          const bigger = resizeRoom(layout, { [key]: ROOM.step });
          return (
            <div key={key} className="flex min-h-7 items-center gap-1">
              <Text bare tone="muted" className="flex-1 text-ui">
                {label}
              </Text>
              <IconButton
                label={`Less ${label.toLowerCase()}`}
                disabled={smaller === layout}
                onClick={() => props.onLayout(smaller)}
              >
                <Minus aria-hidden="true" />
              </IconButton>
              <Text bare tone="default" className="w-6 text-center text-ui tabular-nums">
                {value}
              </Text>
              <IconButton
                label={`More ${label.toLowerCase()}`}
                disabled={bigger === layout}
                onClick={() => props.onLayout(bigger)}
              >
                <Plus aria-hidden="true" />
              </IconButton>
            </div>
          );
        })}
      </div>
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
      <Surface
        as="aside"
        tone="scene-panel"
        radius="2xl"
        className="absolute top-3 left-3 z-[var(--stack-overlay)] grid max-h-[calc(100%-6rem)] w-55 gap-0.5 overflow-y-auto p-2"
        aria-label="Furniture"
      >
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
              <Plus aria-hidden="true" className="opacity-60" />
            </Button>
          );
        })}
        <RoomSizer layout={layout} onLayout={props.onLayout} />
        <Button className="mt-1" onClick={props.onReset}>
          Reset layout
        </Button>
      </Surface>
      {picked ? (
        <Surface
          tone="scene-panel"
          radius="xl"
          className="absolute inset-x-0 bottom-19 z-[var(--stack-overlay)] mx-auto flex w-fit items-center gap-1.5 py-1.5 pr-2 pl-3"
          role="toolbar"
          aria-label={furniture[picked.kind].label}
        >
          <Text bare tone="bright" className="px-1 text-sm font-medium">
            {furniture[picked.kind].label}
          </Text>
          {picked.kind === "desk" ? (
            <OptionSelect
              aria-label="Whose desk"
              className="w-44"
              value={picked.agent ?? ""}
              options={[
                { value: "", label: "Anyone", icon: Users },
                ...props.agents.map(({ agent }) => ({
                  value: agent.id,
                  label: agent.name,
                  icon: <AgentAvatar agent={agent} compact />,
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
        </Surface>
      ) : null}
    </>
  );
}
