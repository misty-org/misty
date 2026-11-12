import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { IconButton } from "../controls/IconButton";
import type { ActionBarItem } from "./ActionBar";

export interface IconBarItemOptions {
  id: string;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  priority: number;
  /** A toggle that is on, here and in the ⋯ menu once it folds. */
  pressed?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  /** For a button that must not take focus from a field, such as a find bar's. */
  onMouseDown?(event: MouseEvent<HTMLButtonElement>): void;
  onSelect(): void;
}

/**
 * An ActionBar item drawn as an icon button in every mode, for bars whose actions read best as
 * glyphs (an editor's head, a find bar). It folds into the bar's ⋯ with its label like any item.
 *
 * ```tsx
 * <ActionBar label="Find options" items={[iconBarItem({ id: "case", icon: CaseSensitive,
 *   label: "Match case", priority: 1, pressed: matchCase, onSelect: toggleCase })]} />
 * ```
 */
export function iconBarItem(item: IconBarItemOptions): ActionBarItem {
  const Icon = item.icon;
  return {
    id: item.id,
    icon: item.icon,
    label: item.label,
    shortcut: item.shortcut,
    priority: item.priority,
    pressed: item.pressed,
    disabled: item.disabled,
    onSelect: item.onSelect,
    render: () => (
      <IconButton
        label={item.label}
        shortcut={item.shortcut}
        size={item.size}
        aria-pressed={item.pressed}
        disabled={item.disabled}
        onMouseDown={item.onMouseDown}
        onClick={item.onSelect}
      >
        <Icon />
      </IconButton>
    ),
  };
}
