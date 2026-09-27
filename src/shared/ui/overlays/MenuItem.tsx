import * as React from "react";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./ContextMenu";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./DropdownMenu";
import { menuShortcutClass, menuWidthClass, type MenuWidth } from "./popupStyles";

type RowProps = {
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** A key hint such as "⌘T" or a <ShortcutText /> element. */
  shortcut?: React.ReactNode;
};

function RowBody({ icon, label, shortcut }: RowProps) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className={menuShortcutClass}>{shortcut}</span> : null}
    </>
  );
}

type ItemProps<T extends React.ElementType> = RowProps &
  Omit<React.ComponentPropsWithoutRef<T>, "children" | "variant"> & { destructive?: boolean };

type SubmenuProps = Omit<RowProps, "shortcut"> & {
  children: React.ReactNode;
  width?: MenuWidth;
  disabled?: boolean;
  /** Native tooltip on the row, e.g. why it is disabled. */
  title?: string;
};

/** The one dropdown row: icon · label · shortcut. Every dropdown menu is built from these. */
const MenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuItem>,
  ItemProps<typeof DropdownMenuItem>
>(({ icon, label, shortcut, destructive, ...props }, ref) => (
  <DropdownMenuItem ref={ref} variant={destructive ? "destructive" : "default"} {...props}>
    <RowBody icon={icon} label={label} shortcut={shortcut} />
  </DropdownMenuItem>
));
MenuItem.displayName = "MenuItem";

/** A dropdown row that opens a nested menu; the right chevron comes from the sub-trigger. */
function MenuSubmenu({ icon, label, children, width = "md", disabled, title }: SubmenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} title={title}>
        <RowBody icon={icon} label={label} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={menuWidthClass[width]}>{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The context-menu twin of MenuItem, so right-click menus read the same as dropdowns. */
const ContextMenuAction = React.forwardRef<
  React.ElementRef<typeof ContextMenuItem>,
  ItemProps<typeof ContextMenuItem>
>(({ icon, label, shortcut, destructive, ...props }, ref) => (
  <ContextMenuItem ref={ref} variant={destructive ? "destructive" : "default"} {...props}>
    <RowBody icon={icon} label={label} shortcut={shortcut} />
  </ContextMenuItem>
));
ContextMenuAction.displayName = "ContextMenuAction";

function ContextMenuSubmenu({
  icon,
  label,
  children,
  width = "md",
  disabled,
  title,
}: SubmenuProps) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled} title={title}>
        <RowBody icon={icon} label={label} />
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className={menuWidthClass[width]}>{children}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export { ContextMenuAction, ContextMenuSubmenu, MenuItem, MenuSubmenu };
