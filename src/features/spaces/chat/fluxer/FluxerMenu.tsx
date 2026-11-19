// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/ui/action_menu/
// ContextMenu.tsx (MenuItem, MenuGroup, MenuSeparator) and ContextMenu.module.css, on Radix's
// popover: a menu opened by a button, or at the pointer for a right-click.
import * as Popover from "@radix-ui/react-popover";
import { Fragment, useRef, type ReactNode, type RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./css/ContextMenu.module.css";
import shell from "./css/SpaceChatShell.module.css";
import { cx } from "./cx";

export interface FluxerMenuItem {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect(): void;
}

/** Groups of items, parted by Fluxer's separator, with an optional row on top (quick reactions). */
export type FluxerMenuGroups = FluxerMenuItem[][];

/** A point the menu opens at, for a right-click. */
export type MenuPoint = { x: number; y: number };

export function FluxerMenu(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  groups: FluxerMenuGroups;
  /** The button it opens from, or the pointer for a right-click. */
  anchor: RefObject<HTMLElement | null> | MenuPoint | null;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  top?: ReactNode;
  label: string;
}) {
  const point = props.anchor && "x" in props.anchor ? props.anchor : null;
  const virtual = useRef({
    getBoundingClientRect: () => new DOMRect(point?.x ?? 0, point?.y ?? 0, 0, 0),
  });
  virtual.current.getBoundingClientRect = () => new DOMRect(point?.x ?? 0, point?.y ?? 0, 0, 0);
  const element = props.anchor && !("x" in props.anchor) ? props.anchor : null;
  if (element) {
    virtual.current.getBoundingClientRect = () =>
      element.current?.getBoundingClientRect() ?? new DOMRect();
  }
  const groups = props.groups.filter((group) => group.length);
  return (
    <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Popover.Anchor virtualRef={virtual} />
      <Popover.Portal>
        <Popover.Content
          side={props.side ?? (point ? "right" : "bottom")}
          align={props.align ?? "start"}
          sideOffset={4}
          collisionPadding={12}
          aria-label={props.label}
          className={cx("fluxer-chat", styles.contextMenu, shell.popoutMotion)}
          style={{ zIndex: 60, minWidth: "min(208px, calc(100vw - 24px))" }}
        >
          {props.top}
          {groups.map((group, index) => (
            <Fragment key={index}>
              {index > 0 ? <div className={styles.separator} /> : null}
              <div className={styles.group}>
                {group.map((item) => (
                  <MenuRow key={item.label} item={item} onDone={() => props.onOpenChange(false)} />
                ))}
              </div>
            </Fragment>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuRow(props: { item: FluxerMenuItem; onDone(): void }) {
  const { item } = props;
  const Glyph = item.icon;
  return (
    <button
      type="button"
      disabled={item.disabled}
      className={cx(styles.item, item.danger && styles.danger, item.disabled && styles.disabled)}
      onMouseEnter={(event) => event.currentTarget.focus()}
      onClick={() => {
        props.onDone();
        item.onSelect();
      }}
    >
      <div className={item.hint ? styles.itemLabelContainer : styles.itemLabel}>
        {item.hint ? (
          <>
            <div className={styles.itemLabelText}>{item.label}</div>
            <div className={styles.itemHint}>{item.hint}</div>
          </>
        ) : (
          item.label
        )}
      </div>
      {Glyph ? (
        <div className={styles.itemIcon}>
          <Glyph />
        </div>
      ) : null}
    </button>
  );
}
