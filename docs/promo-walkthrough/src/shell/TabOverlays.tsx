import { Button, cn } from "@/shared/ui";
import {
  menuItemClass,
  menuLabelClass,
  menuListClass,
  menuSeparatorClass,
  popupSurfaceClass,
} from "@/shared/ui/overlays/popupStyles";
import { ChevronRight, Plus } from "lucide-react";
import type { GroupEditorState, TabMenuState } from "../film/state";

/** The gray entry of the nine tab-group colors; the film stays monochrome. */
export const GROUP_COLOR = "#a6a6ad";
const SWATCHES = ["#a6a6ad", "#8f8f96", "#c4c4c8", "#77777d", "#d8d8db", "#5f5f64", "#b4b4b9", "#9c9ca1", "#6b6b70"];

function Item(props: { label: string; t?: string; highlight?: boolean; icon?: React.ReactNode; sub?: boolean }) {
  return (
    <div data-t={props.t} data-highlighted={props.highlight ? "" : undefined} className={menuItemClass}>
      {props.icon}
      <span className="flex-1">{props.label}</span>
      {props.sub && <ChevronRight className="size-4 text-cream-muted" aria-hidden />}
    </div>
  );
}

export function TabMenu({ menu, groupName }: { menu: TabMenuState; groupName?: string }) {
  return (
    <div className="absolute left-2 top-[calc(100%+6px)] z-50 flex items-start gap-1 text-left">
      <div className={cn(menuListClass, popupSurfaceClass, "w-56")}>
        <Item label="New tab to the right" />
        <Item label="Reload" />
        <Item label="Duplicate" />
        <div className={menuSeparatorClass} />
        <Item label="Add tab to group" t="menu-add-group" highlight={menu.highlight === "add" || menu.submenu} sub />
        <div className={menuSeparatorClass} />
        <Item label="Close tab" />
      </div>
      {menu.submenu && (
        <div className={cn(menuListClass, popupSurfaceClass, "mt-[84px] w-48")}>
          <Item label="New group" t="menu-new-group" icon={<Plus className="size-4" />} highlight={menu.highlight === "new"} />
          {groupName && (
            <Item
              label={groupName}
              t="menu-existing-group"
              highlight={menu.highlight === "add"}
              icon={<span className="size-2.5 rounded-full" style={{ background: GROUP_COLOR }} />}
            />
          )}
        </div>
      )}
    </div>
  );
}

const actions = ["New tab in group", "Move group to new window", "Ungroup tabs", "Close and save group", "Delete group and close tabs"];

/** Anchored, nonmodal group editor: name, color, group actions, Done. */
export function GroupEditor({ editor }: { editor: GroupEditorState }) {
  return (
    <div className={cn(popupSurfaceClass, "absolute left-0 top-[calc(100%+8px)] z-50 w-72 p-3 text-left")}>
      <label className="block">
        <span className={cn(menuLabelClass, "px-0 text-sm text-cream")}>Group name</span>
        <span
          data-t="group-name"
          className="mt-1.5 flex h-9 items-center rounded-md border border-charcoal-border bg-charcoal-bg px-3 text-sm text-cream-bright ring-2 ring-cream/15"
        >
          {editor.name}
          {editor.caret && <span className="ml-px inline-block h-4 w-px bg-cream-bright" />}
        </span>
      </label>
      <p className="mt-3 mb-2 text-sm text-cream">Color</p>
      <div className="flex gap-1.5">
        {SWATCHES.map((color, index) => (
          <span
            key={color}
            className={cn("size-6 rounded-full", index === 0 && "ring-2 ring-cream ring-offset-2 ring-offset-charcoal-card")}
            style={{ background: color }}
          />
        ))}
      </div>
      <div className={cn(menuSeparatorClass, "mx-0 my-3")} />
      <div className="grid gap-0.5">
        {actions.map((label) => (
          <span key={label} className="px-2 py-1.5 text-sm text-cream">
            {label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button data-t="group-done" className={cn(editor.done && "bg-[#494949]")}>
          Done
        </Button>
      </div>
    </div>
  );
}
