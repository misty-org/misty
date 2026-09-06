import { flushSync } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui";
import type {
  ContextMenuEntry,
  ContextMenuLeafItem,
} from "../model/types/workspace/ExplorerContextMenu";

export function ExplorerContextMenuView({
  open,
  x,
  y,
  menuEntries,
  onClose,
}: {
  open: boolean;
  x: number;
  y: number;
  menuEntries: ContextMenuEntry[];
  onClose: () => void;
}) {
  const renderLeaf = (item: ContextMenuLeafItem) => (
    <DropdownMenuItem
      key={item.id}
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      onSelect={() => {
        // Release the menu's modal layer before an action opens a dialog.
        flushSync(onClose);
        item.onRun();
      }}
    >
      <span className="inline-flex w-[19px] items-center justify-center text-cream-muted">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {item.label}
      </span>
      {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  );

  return open ? (
    <DropdownMenu
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" className="fixed size-0" style={{ left: x, top: y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={8}
        className="max-h-[min(560px,calc(100dvh-2rem))] w-[250px] overflow-y-auto"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {menuEntries.map((item) =>
          "items" in item ? (
            <DropdownMenuSub key={item.id}>
              <DropdownMenuSubTrigger
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason : undefined}
              >
                <span className="inline-flex w-[19px] items-center justify-center text-cream-muted">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[min(560px,calc(100dvh-2rem))] w-[246px] overflow-y-auto">
                {item.items.map(renderLeaf)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            renderLeaf(item)
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
}
