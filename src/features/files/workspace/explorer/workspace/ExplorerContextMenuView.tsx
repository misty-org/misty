import { flushSync } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  MenuSubmenu,
  Portal,
} from "@/shared/ui";
import type {
  ContextMenuEntry,
  ContextMenuLeafItem,
} from "../model/types/workspace/ExplorerContextMenu";

/** Right-click menu for explorer entries, anchored to the pointer position. */
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
    <MenuItem
      key={item.id}
      icon={item.icon}
      label={item.label}
      shortcut={item.shortcut}
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      onSelect={() => {
        // Release the menu's modal layer before an action opens a dialog.
        flushSync(onClose);
        item.onRun();
      }}
    />
  );

  return open ? (
    <DropdownMenu
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Portal>
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" className="fixed size-0" style={{ left: x, top: y }} />
        </DropdownMenuTrigger>
      </Portal>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={8}
        width="lg"
        className="max-h-[min(560px,calc(100dvh-2rem))]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {menuEntries.map((item) =>
          "items" in item ? (
            <MenuSubmenu
              key={item.id}
              icon={item.icon}
              label={item.label}
              width="lg"
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
            >
              {item.items.map(renderLeaf)}
            </MenuSubmenu>
          ) : (
            renderLeaf(item)
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
}
