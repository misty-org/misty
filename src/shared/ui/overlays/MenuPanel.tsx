import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";
import { asKbd } from "../display/Kbd";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import {
  menuIconClass,
  menuItemClass,
  menuLabelClass,
  menuLabelTextClass,
  menuListClass,
  menuSeparatorClass,
  menuShortcutClass,
  popupSurfaceClass,
} from "./popupStyles";

/*
 * A menu that is a small window of its own rather than a popup inside one, such as the panel
 * under Misty's menu bar icon. It has the same surface and rows as every dropdown, and fills its
 * window but for a clear margin the shadow falls into, so the window can be see-through.
 */

type MenuPanelProps = {
  children: React.ReactNode;
  "aria-label": string;
  ref?: React.Ref<HTMLDivElement>;
};

function MenuPanel({ children, ref, ...props }: MenuPanelProps) {
  return (
    <div
      ref={ref}
      role="menu"
      data-slot="menu-panel"
      className={cn("m-4 overflow-hidden", popupSurfaceClass, menuListClass)}
      {...props}
    >
      {children}
    </div>
  );
}

type MenuPanelHeaderProps = {
  /** The mark of what the panel belongs to, such as `<MistyMark className="size-5" />`. */
  mark: React.ReactNode;
  title: string;
  /** A muted word at the right end, such as the version. */
  detail?: string;
};

/** The panel's first row: whose panel it is. */
function MenuPanelHeader({ mark, title, detail }: MenuPanelHeaderProps) {
  return (
    <div className="flex min-h-10 items-center gap-2 px-2">
      <span className="grid size-5 shrink-0 place-items-center text-cream-bright">{mark}</span>
      <OverflowFadeText className="min-w-0 flex-1 text-control font-medium text-cream-bright">
        {title}
      </OverflowFadeText>
      {detail ? <span className="shrink-0 text-meta text-cream-muted">{detail}</span> : null}
    </div>
  );
}

type MenuPanelItemProps = {
  /** A 16px icon when it tells the row apart; a list of like things (chats) is text alone. */
  icon?: LucideIcon;
  label: string;
  /** A muted line under the label, such as the agent a chat belongs to. */
  description?: string;
  /** A key hint such as "⌘Q". */
  shortcut?: string;
  /** What sits at the right end instead of a shortcut: a StateMark or a Switch. */
  state?: React.ReactNode;
  onSelect(): void;
  /** For a row that turns something on or off. */
  checked?: boolean;
};

/** One row of a MenuPanel: icon · label · shortcut or state. */
function MenuPanelItem({
  icon: Icon,
  label,
  description,
  shortcut,
  state,
  onSelect,
  checked,
}: MenuPanelItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      className={cn(menuItemClass, "cursor-pointer")}
      onClick={onSelect}
    >
      {Icon ? <Icon aria-hidden className={menuIconClass} /> : null}
      <span className={cn(menuLabelTextClass, "grid")}>
        <OverflowFadeText>{label}</OverflowFadeText>
        {description ? (
          <OverflowFadeText className="text-meta text-cream-muted">{description}</OverflowFadeText>
        ) : null}
      </span>
      {shortcut ? <span className={menuShortcutClass}>{asKbd(shortcut)}</span> : null}
      {state ? <span className="ml-auto flex shrink-0 items-center pl-2">{state}</span> : null}
    </button>
  );
}

/** A small heading over a group of rows, such as "Agents". */
function MenuPanelLabel({ children }: { children: string }) {
  return <div className={menuLabelClass}>{children}</div>;
}

/** The hairline between groups of rows. */
function MenuPanelSeparator() {
  return <div role="separator" className={menuSeparatorClass} />;
}

export { MenuPanel, MenuPanelHeader, MenuPanelItem, MenuPanelLabel, MenuPanelSeparator };
