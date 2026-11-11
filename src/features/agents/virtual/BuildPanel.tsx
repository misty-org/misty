import {
  Armchair,
  BookOpen,
  Coffee,
  GlassWater,
  Lamp,
  Monitor,
  Plus,
  Presentation,
  RectangleHorizontal,
  RotateCw,
  Sofa,
  Sprout,
  Table,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button, IconButton, OptionSelect } from "@/shared/ui";
import { furniture, furnitureKinds, type FurnitureKind } from "./office/catalog";
import { addItem, assignDesk, removeItem, rotateItem, type OfficeLayout } from "./office/layout";
import type { OfficeAgent } from "./useOfficeAgents";

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
 * Build mode's controls: a palette that adds a piece of furniture to the room, and, for the piece
 * that is picked, turning it, removing it and, for a desk, choosing whose it is. Moving is done by
 * dragging the piece in the room itself.
 */
export function BuildPanel(props: {
  layout: OfficeLayout;
  agents: OfficeAgent[];
  picked: string | null;
  onPick(id: string | null): void;
  onLayout(next: OfficeLayout): void;
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
      <aside className="virtual-office-palette" aria-label="Furniture">
        {furnitureKinds.map((kind) => {
          const Icon = icons[kind];
          return (
            <Button key={kind} variant="ghost" size="sm" justify="start" onClick={() => add(kind)}>
              <Icon aria-hidden="true" />
              <span className="flex-1 text-left">{furniture[kind].label}</span>
              <Plus aria-hidden="true" className="size-3.5 opacity-60" />
            </Button>
          );
        })}
        <Button variant="outline" size="sm" className="mt-1" onClick={props.onReset}>
          Reset layout
        </Button>
      </aside>
      {picked ? (
        <div
          className="virtual-office-piece"
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
                { value: "", label: "Anyone" },
                ...props.agents.map(({ agent }) => ({ value: agent.id, label: agent.name })),
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
