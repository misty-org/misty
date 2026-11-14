// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronRight } from "lucide-react";
import { RowControls } from "../controls/RowContext";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../classNames";
import { Pressable } from "../controls/Pressable";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { RowActions, type RowActionsProps } from "../overlays/RowActions";
import { Text } from "./Text";

/**
 * The name's color, where it carries meaning: what Git says of the file (new, changed, gone), or
 * a folder that is a repository of its own.
 */
export type TreeRowTone = "added" | "modified" | "removed" | "repository";

const toneClass: Record<TreeRowTone, string> = {
  added: "text-state-done",
  modified: "text-state-waiting",
  removed: "text-state-failed",
  repository: "text-state-working",
};

export interface TreeRowProps {
  /** The item's name, the first thing on the row. It fades when long. */
  label: string;
  /** The whole text for the name's tooltip when it fades, such as the path. */
  full?: string;
  /** How deep the item sits: each level indents the row by 16px. */
  depth?: number;
  /** Set for an item that opens and closes, such as a folder: its `aria-expanded`. */
  expanded?: boolean;
  /** Draws a chevron before the name that turns as `expanded` changes. */
  chevron?: boolean;
  /** The 16px mark before the name, such as the file's icon. */
  icon?: ReactNode;
  /** A control before the row's opener, such as a checkbox for the commit. */
  leading?: ReactNode;
  /** Muted text after the name, such as the folder a file is in. */
  detail?: string;
  /** The item's state at the end of the row: a spinner, a count, Git's letter. */
  end?: ReactNode;
  selected?: boolean;
  /** Faded, for an item Git ignores. */
  dimmed?: boolean;
  tone?: TreeRowTone;
  onOpen(): void;
  /** The opener's accessible name when it should say more than the name. */
  openLabel?: string;
  /** The row's actions as menu rows: a ⋯ at its end and the same menu on a right-click. */
  menu?: ReactNode;
  /** The ⋯'s name and tooltip. Defaults to "Actions for {label}". */
  menuLabel?: string;
  menuWidth?: RowActionsProps["width"];
  /** Told as either menu opens or closes, so the actions know which row they are for. */
  onMenuOpenChange?(open: boolean): void;
  /** `li` inside a list. */
  as?: "div" | "li";
  /** For a virtual list's placement. */
  style?: CSSProperties;
}

/** Where a row at depth 0 starts, and how far each level indents it. */
const baseIndent = 8;
const levelIndent = 16;

/**
 * One row of a tree (files, changes): 32px, indented by depth, an optional chevron and icon, the
 * name first, the state at the end, and one ⋯ that opens the same menu as a right-click.
 *
 * ```tsx
 * <TreeRow label="src" depth={1} expanded={open} chevron onOpen={toggle}
 *   end={<Text size="meta" tone="muted">4</Text>} menu={<FolderMenuRows />} />
 * ```
 */
export function TreeRow(props: TreeRowProps) {
  const Row = props.as ?? "div";
  return (
    <Row
      data-selected={props.selected || undefined}
      className={cn(
        "group/row flex h-8 min-w-0 items-center gap-2 rounded-md pr-1",
        "hover:bg-control-hover data-[selected]:bg-control-active",
      )}
      style={{ ...props.style, paddingLeft: baseIndent + (props.depth ?? 0) * levelIndent }}
    >
      {props.leading}
      <Pressable
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2",
          props.dimmed && "opacity-50",
        )}
        aria-expanded={props.expanded}
        aria-label={props.openLabel}
        onClick={props.onOpen}
      >
        {props.chevron ? (
          <ChevronRight
            aria-hidden
            className={cn("size-4 flex-none transition-transform", props.expanded && "rotate-90")}
          />
        ) : null}
        {props.icon ? (
          <span aria-hidden className="flex size-4 flex-none items-center [&>svg]:size-4">
            {props.icon}
          </span>
        ) : null}
        <OverflowFadeText
          data-tone={props.tone}
          className={cn("min-w-0 text-control", props.tone && toneClass[props.tone])}
          full={props.full ?? true}
        >
          {props.label}
        </OverflowFadeText>
        {props.detail ? (
          <Text size="meta" tone="muted" className="min-w-0 flex-1">
            {props.detail}
          </Text>
        ) : (
          <span className="flex-1" />
        )}
      </Pressable>
      <RowControls>{props.end}</RowControls>
      {props.menu ? (
        <RowActions
          label={props.menuLabel ?? `Actions for ${props.label}`}
          width={props.menuWidth}
          onOpenChange={props.onMenuOpenChange}
        >
          {props.menu}
        </RowActions>
      ) : null}
    </Row>
  );
}
