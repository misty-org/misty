import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../classNames";
import { asKbd } from "../display/Kbd";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import {
  ContextMenuCheckboxItem,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./ContextMenu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./DropdownMenu";
import {
  MenuKindContext,
  menuIconClass,
  menuItemExplainedClass,
  menuLabelTextClass,
  menuShortcutClass,
  menuWidthClass,
  useMenuKind,
  type MenuKind,
  type MenuWidth,
} from "./popupStyles";
import { Tooltip } from "./Tooltip";

/*
 * Every menu row, in dropdowns and right-click menus alike: a 16px icon when it tells the row
 * apart, the label, an optional shortcut on an action, and a checkmark at the right edge when the
 * row is a selection. A list of like things (models, efforts, folders, agents, chats) is text
 * alone: the same icon on every row says nothing. A choice (MenuRadioItem) never shows a
 * shortcut, and a MenuRadioGroup drops its rows' icons unless every row has its own.
 *
 * The rows read which kind of menu they are in from DropdownMenuContent or ContextMenuContent, so
 * one tree of rows can be written once and shown in both (RowActions does exactly that).
 */

/**
 * A row's leading 16px icon. Pass the icon itself (`icon={Pencil}`); an element such as a brand
 * mark (`icon={<EngineMark engine={id} />}`) works too.
 */
type MenuIcon = LucideIcon | React.ComponentType<{ className?: string }> | React.ReactElement;

function isIconComponent(icon: unknown): boolean {
  if (typeof icon === "function") return true;
  // forwardRef and memo components (Lucide's icons among them) are objects, not functions.
  return (
    typeof icon === "object" &&
    icon !== null &&
    !React.isValidElement(icon) &&
    ("render" in icon || "type" in icon)
  );
}

/** Draws a row's icon from either form. Also used by Select, Command and SuggestionList rows. */
function MenuIconSlot({ icon }: { icon?: MenuIcon | React.ReactNode }) {
  if (icon === null || icon === undefined || icon === false) return null;
  if (!isIconComponent(icon)) return <>{icon as React.ReactNode}</>;
  const Icon = icon as React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  return <Icon aria-hidden className={menuIconClass} />;
}

type RowBodyProps = {
  icon?: MenuIcon | React.ReactNode;
  label: React.ReactNode;
  shortcut?: React.ReactNode;
  state?: React.ReactNode;
};

function MenuRowBody({ icon, label, shortcut, state }: RowBodyProps) {
  return (
    <>
      <MenuIconSlot icon={icon} />
      <OverflowFadeText className={menuLabelTextClass}>{label}</OverflowFadeText>
      {shortcut ? <span className={menuShortcutClass}>{asKbd(shortcut)}</span> : null}
      {state ? <span className="ml-auto flex shrink-0 items-center pl-2">{state}</span> : null}
    </>
  );
}

/** A disabled row that says why: the reason shows in Misty's tooltip beside the row. */
function Explained({ reason, children }: { reason?: string; children: React.ReactElement }) {
  if (!reason) return children;
  return (
    <Tooltip content={reason} side="right">
      {children}
    </Tooltip>
  );
}

type RadixItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuItem>,
  "children" | "variant" | "asChild"
>;

type MenuItemProps = RadixItemProps & {
  /** The 16px icon an action starts with, when it tells the row apart. Rows listing like things
   * (agents, chats, folders) leave it out. */
  icon?: MenuIcon;
  /** The row's text. It fades at the end when the menu is too narrow. */
  label: React.ReactNode;
  /** A key hint such as "⌘T" or a <ShortcutText /> element. */
  shortcut?: React.ReactNode;
  /** Paints the label and icon in the danger color, for rows that delete. */
  danger?: boolean;
  /** Why a disabled row can't be used, shown in a tooltip while it is hovered. */
  reason?: string;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * The one menu row: icon · label · shortcut. Works inside a DropdownMenu or a ContextMenu.
 *
 * ```tsx
 * <MenuItem icon={Pencil} label="Rename" shortcut="R" onSelect={rename} />
 * <MenuItem icon={Trash2} label="Delete" danger onSelect={confirmDelete} />
 * <MenuItem icon={GitFork} label="Fork" disabled={working} reason="Wait for the run to finish" />
 * ```
 */
function MenuItem({
  icon,
  label,
  shortcut,
  danger,
  reason,
  disabled,
  className,
  ref,
  ...props
}: MenuItemProps) {
  const kind = useMenuKind();
  const Item = (kind === "context" ? ContextMenuItem : DropdownMenuItem) as typeof DropdownMenuItem;
  const explained = disabled && reason ? reason : undefined;
  return (
    <Explained reason={explained}>
      <Item
        ref={ref}
        variant={danger ? "danger" : "default"}
        disabled={disabled}
        className={cn(explained && menuItemExplainedClass, className)}
        {...props}
      >
        <MenuRowBody icon={icon} label={label} shortcut={shortcut} />
      </Item>
    </Explained>
  );
}

type MenuCheckItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuCheckboxItem>,
  "children" | "checked" | "onCheckedChange" | "asChild"
> & {
  /** Only when it tells the row apart from the others; a list of like things is text alone. */
  icon?: MenuIcon;
  label: React.ReactNode;
  shortcut?: React.ReactNode;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Why a disabled row can't be used, shown in a tooltip while it is hovered. */
  reason?: string;
  /** Close the menu once toggled. Off by default, so several rows can be toggled in one visit. */
  closeOnSelect?: boolean;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * A row that turns something on or off, with a checkmark at its right edge while on.
 *
 * ```tsx
 * <MenuCheckItem label="Owner" checked={shown.owner} onCheckedChange={toggleOwner} />
 * ```
 */
function MenuCheckItem({
  icon,
  label,
  shortcut,
  checked,
  onCheckedChange,
  reason,
  closeOnSelect = false,
  disabled,
  className,
  onSelect,
  ref,
  ...props
}: MenuCheckItemProps) {
  const kind = useMenuKind();
  const Item = (
    kind === "context" ? ContextMenuCheckboxItem : DropdownMenuCheckboxItem
  ) as typeof DropdownMenuCheckboxItem;
  const explained = disabled && reason ? reason : undefined;
  return (
    <Explained reason={explained}>
      <Item
        ref={ref}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange?.(next === true)}
        onSelect={(event) => {
          onSelect?.(event);
          if (!closeOnSelect) event.preventDefault();
        }}
        disabled={disabled}
        className={cn(explained && menuItemExplainedClass, className)}
        {...props}
      >
        <MenuRowBody icon={icon} label={label} shortcut={shortcut} />
      </Item>
    </Explained>
  );
}

type MenuRadioGroupProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuRadioGroup>,
  "value" | "onValueChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  ref?: React.Ref<HTMLDivElement>;
};

/** Whether a group's rows show their icons: inside a MenuRadioGroup, only when they differ. */
const RadioIconsContext = React.createContext(true);

/** The icons of a group's rows, through arrays and fragments. */
function rowIcons(children: React.ReactNode): unknown[] {
  const icons: unknown[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: unknown; icon?: unknown; children?: React.ReactNode };
    if (child.type === React.Fragment) icons.push(...rowIcons(props.children));
    else if (props.value !== undefined) icons.push(props.icon);
  });
  return icons;
}

/** What makes two row icons the same: the same component, or elements of one type and props. */
function sameIcon(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!React.isValidElement(a) || !React.isValidElement(b) || a.type !== b.type) return false;
  const left = a.props as Record<string, unknown>;
  const right = b.props as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => key === "children" || left[key] === right[key]);
}

/** True when every row has an icon and no two are the same, so the icons tell them apart. */
function iconsTellApart(icons: unknown[]): boolean {
  if (icons.length < 2 || icons.some((icon) => icon === undefined || icon === null)) return false;
  return icons.every((icon, index) =>
    icons.slice(index + 1).every((other) => !sameIcon(icon, other)),
  );
}

/**
 * A set of MenuRadioItems where exactly one is picked, such as a sort order. Its rows are text
 * alone unless each has an icon of its own: a list of efforts or models, each with the same mark,
 * reads better without them.
 *
 * ```tsx
 * <MenuRadioGroup value={effort} onValueChange={setEffort}>
 *   <MenuRadioItem value="low" label="Low" />
 *   <MenuRadioItem value="high" label="High" />
 * </MenuRadioGroup>
 * ```
 */
function MenuRadioGroup({ children, ...props }: MenuRadioGroupProps) {
  const kind = useMenuKind();
  const Group = (
    kind === "context" ? ContextMenuRadioGroup : DropdownMenuRadioGroup
  ) as typeof DropdownMenuRadioGroup;
  return (
    <RadioIconsContext.Provider value={iconsTellApart(rowIcons(children))}>
      <Group {...props}>{children}</Group>
    </RadioIconsContext.Provider>
  );
}

type MenuRadioItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuRadioItem>,
  "children" | "asChild"
> & {
  /** Shown only when every row in the group has an icon of its own (MenuRadioGroup). */
  icon?: MenuIcon;
  label: React.ReactNode;
  /** The row's state at its right end, before the checkmark, such as a Spinner while it works. */
  state?: React.ReactNode;
  /** Why a disabled row can't be used, shown in a tooltip while it is hovered. */
  reason?: string;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * One choice in a MenuRadioGroup, with a checkmark at its right edge while picked. A choice shows
 * no shortcut: the menu is where it is picked, not where its key is learned.
 */
function MenuRadioItem({
  icon,
  label,
  state,
  reason,
  disabled,
  className,
  ref,
  ...props
}: MenuRadioItemProps) {
  const kind = useMenuKind();
  const showIcon = React.useContext(RadioIconsContext);
  const Item = (
    kind === "context" ? ContextMenuRadioItem : DropdownMenuRadioItem
  ) as typeof DropdownMenuRadioItem;
  const explained = disabled && reason ? reason : undefined;
  return (
    <Explained reason={explained}>
      <Item
        ref={ref}
        disabled={disabled}
        className={cn(explained && menuItemExplainedClass, className)}
        {...props}
      >
        <MenuRowBody icon={showIcon ? icon : undefined} label={label} state={state} />
      </Item>
    </Explained>
  );
}

type MenuSubmenuProps = {
  /** The 16px icon, when it tells the row apart. */
  icon?: MenuIcon;
  label: React.ReactNode;
  children: React.ReactNode;
  width?: MenuWidth;
  disabled?: boolean;
  /** Why a disabled row can't be used, shown in a tooltip while it is hovered. */
  reason?: string;
};

/**
 * A row that opens a nested menu; the right chevron comes from the sub-trigger.
 *
 * ```tsx
 * <MenuSubmenu icon={FolderInput} label="Move to">
 *   <MenuItem icon={Folder} label="Drafts" onSelect={…} />
 * </MenuSubmenu>
 * ```
 */
function MenuSubmenu({ icon, label, children, width = "md", disabled, reason }: MenuSubmenuProps) {
  const kind = useMenuKind();
  const context = kind === "context";
  const Sub = context ? ContextMenuSub : DropdownMenuSub;
  const Trigger = (
    context ? ContextMenuSubTrigger : DropdownMenuSubTrigger
  ) as typeof DropdownMenuSubTrigger;
  const Content = (
    context ? ContextMenuSubContent : DropdownMenuSubContent
  ) as typeof DropdownMenuSubContent;
  const explained = disabled ? reason : undefined;
  return (
    <Sub>
      <Explained reason={explained}>
        <Trigger disabled={disabled} className={cn(explained && menuItemExplainedClass)}>
          <MenuRowBody icon={icon} label={label} />
        </Trigger>
      </Explained>
      <Content className={menuWidthClass[width]}>{children}</Content>
    </Sub>
  );
}

/** A hairline between groups of rows, in either kind of menu. */
function MenuSeparator(props: React.ComponentPropsWithoutRef<typeof DropdownMenuSeparator>) {
  const Separator = (
    useMenuKind() === "context" ? ContextMenuSeparator : DropdownMenuSeparator
  ) as typeof DropdownMenuSeparator;
  return <Separator {...props} />;
}

/** A muted heading over a group of rows, in either kind of menu. */
function MenuLabel(props: React.ComponentPropsWithoutRef<typeof DropdownMenuLabel>) {
  const Label = (
    useMenuKind() === "context" ? ContextMenuLabel : DropdownMenuLabel
  ) as typeof DropdownMenuLabel;
  return <Label {...props} />;
}

/** Groups rows for assistive tech, in either kind of menu. */
function MenuGroup(props: React.ComponentPropsWithoutRef<typeof DropdownMenuGroup>) {
  const Group = (
    useMenuKind() === "context" ? ContextMenuGroup : DropdownMenuGroup
  ) as typeof DropdownMenuGroup;
  return <Group {...props} />;
}

/**
 * Sets the kind of menu for rows rendered outside DropdownMenuContent or ContextMenuContent,
 * which set it themselves. Rarely needed.
 */
function MenuKindProvider({ kind, children }: { kind: MenuKind; children: React.ReactNode }) {
  return <MenuKindContext.Provider value={kind}>{children}</MenuKindContext.Provider>;
}

export {
  MenuCheckItem,
  MenuGroup,
  MenuIconSlot,
  MenuItem,
  MenuKindProvider,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  useMenuKind,
};
export type {
  MenuCheckItemProps,
  MenuIcon,
  MenuItemProps,
  MenuKind,
  MenuRadioGroupProps,
  MenuRadioItemProps,
  MenuSubmenuProps,
};
