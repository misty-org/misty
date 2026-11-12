import { Check, Ellipsis, GripVertical, type LucideIcon } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { reorderIds, usePointerReorder } from "@/shared/hooks/usePointerReorder";
import {
  Checkbox,
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuTrigger,
  DragHandleButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuItem,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui";
import { SidebarRow } from "./SidebarRow";
import { useSidebarPins, type SidebarPlaceId } from "./sidebarPinsStore";

export interface SidebarPlace {
  label: string;
  icon: LucideIcon;
  current: boolean;
  open(): void;
}

/**
 * The last of the sidebar's places: More lists every row that is not pinned. Right-clicking it,
 * or its own last item, opens the list of all rows to pin and reorder.
 */
export function SidebarMore({ places }: { places: Record<SidebarPlaceId, SidebarPlace> }) {
  const order = useSidebarPins((state) => state.order);
  const pinned = useSidebarPins((state) => state.pinned);
  const [reordering, setReordering] = useState(false);
  // The list opens once the menu that asked for it has closed, so the menu handing focus back
  // to More cannot close the list again.
  const opening = useRef(false);
  const rest = order.filter((id) => !pinned.includes(id));
  const startReordering = () => {
    opening.current = true;
  };
  const afterMenu = (event: Event) => {
    if (!opening.current) return;
    event.preventDefault();
    opening.current = false;
    setReordering(true);
  };

  return (
    <Popover open={reordering} onOpenChange={setReordering}>
      <DropdownMenu>
        <ContextMenu>
          <PopoverAnchor asChild>
            <ContextMenuTrigger asChild>
              <DropdownMenuTrigger asChild>
                <SidebarRow
                  label="More"
                  icon={<Ellipsis className="size-4" aria-hidden="true" />}
                  current={rest.some((id) => places[id].current)}
                />
              </DropdownMenuTrigger>
            </ContextMenuTrigger>
          </PopoverAnchor>
          <ContextMenuContent className="min-w-44" onCloseAutoFocus={afterMenu}>
            <ContextMenuAction label="Reorder pins" onSelect={startReordering} />
          </ContextMenuContent>
        </ContextMenu>
        <DropdownMenuContent side="right" className="min-w-48" onCloseAutoFocus={afterMenu}>
          {rest.map((id) => {
            const { label, icon: Icon, current, open } = places[id];
            return (
              <MenuItem
                key={id}
                icon={<Icon aria-hidden="true" />}
                label={label}
                shortcut={current ? <Check className="size-4" aria-hidden="true" /> : undefined}
                onSelect={open}
              />
            );
          })}
          {rest.length ? <DropdownMenuSeparator /> : null}
          <MenuItem label="Reorder pins" onSelect={startReordering} />
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent side="right" align="start" className="w-56 p-1">
        <ReorderPins places={places} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Every row with a box to pin it. A row drags into place from anywhere but its box, as lists do
 * across Misty; its grip also moves it with the arrow keys.
 */
function ReorderPins({ places }: { places: Record<SidebarPlaceId, SidebarPlace> }) {
  const saved = useSidebarPins();
  const save = (order: SidebarPlaceId[], pinned = saved.pinned) => saved.set({ order, pinned });
  const toggle = (id: SidebarPlaceId, on: boolean) =>
    save(saved.order, on ? [...saved.pinned, id] : saved.pinned.filter((other) => other !== id));
  const moveBy = (id: SidebarPlaceId, direction: -1 | 1) => {
    const target = saved.order[saved.order.indexOf(id) + direction];
    if (target) save(reorderIds(saved.order, [id], target, direction === 1) as SidebarPlaceId[]);
  };
  const reorder = usePointerReorder({
    scope: useId(),
    axis: "y",
    getDrag: (id) => ({ id, label: places[id as SidebarPlaceId]?.label ?? id }),
    onDrop: (drag, target, after) =>
      save(reorderIds(saved.order, [drag.id], target, after) as SidebarPlaceId[]),
    onKeyboardMove: (id, direction) => moveBy(id as SidebarPlaceId, direction),
  });
  const nudge = (id: SidebarPlaceId) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveBy(id, event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <div {...reorder} role="list" aria-label="Pins" className="grid gap-0.5">
      {saved.order.map((id) => {
        const { label, icon: Icon } = places[id];
        return (
          <div
            key={id}
            role="listitem"
            data-reorder-item={id}
            data-reorder-handle=""
            data-reorder-preview=""
            className="flex h-8 cursor-grab items-center gap-2 rounded-md pl-2 text-sm text-cream hover:bg-charcoal-hover active:cursor-grabbing"
          >
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <Checkbox
                data-reorder-ignore=""
                checked={saved.pinned.includes(id)}
                onCheckedChange={(on) => toggle(id, on === true)}
              />
              <Icon className="size-4 shrink-0 text-cream-muted" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </label>
            <DragHandleButton
              label={`Move ${label}`}
              title="Drag, or use the arrow keys"
              className="h-7 cursor-grab touch-none hover:bg-transparent hover:text-cream-muted active:cursor-grabbing"
              onKeyDown={nudge(id)}
            >
              <GripVertical aria-hidden="true" />
            </DragHandleButton>
          </div>
        );
      })}
    </div>
  );
}
