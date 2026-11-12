import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../classNames";
import { IconButton } from "../controls/IconButton";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ContextMenu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./DropdownMenu";
import type { MenuWidth } from "./popupStyles";

/** The row a RowActions belongs to: the nearest element that carries Tailwind's `group/row`. */
const rowSelector = '[class~="group/row"]';

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || !!target.closest("input, textarea, select"))
  );
}

type RowActionsProps = {
  /** What the menu is for, such as "Chat actions": the ⋯ button's name and tooltip. */
  label: string;
  /** The row's actions as MenuItems. The same rows open from the ⋯ and from a right-click. */
  children: React.ReactNode;
  width?: MenuWidth;
  /** Told when either menu opens or closes, e.g. to keep the row highlighted meanwhile. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * A row's one place for its actions: a 24px ⋯ at its right end, shown while the row is hovered,
 * holds focus, or has a menu open, and the same menu on a right-click anywhere on the row.
 * Put it last inside the row; the row is its nearest ancestor with the `group/row` class, which
 * is how ListRow and tiles are built.
 *
 * ```tsx
 * <div className="group/row flex h-8 items-center">
 *   …
 *   <RowActions label="Chat actions">
 *     <MenuItem icon={Pencil} label="Rename" onSelect={rename} />
 *     <MenuSeparator />
 *     <MenuItem icon={Trash2} label="Delete" danger onSelect={confirmDelete} />
 *   </RowActions>
 * </div>
 * ```
 */
function RowActions({ label, children, width, onOpenChange, className }: RowActionsProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const anchorRef = React.useRef<HTMLSpanElement>(null);

  // Radix opens a context menu from its trigger's own contextmenu event, at the pointer. The
  // trigger here is an empty anchor, so a right-click on the row is handed on to it.
  React.useEffect(() => {
    const row = buttonRef.current?.closest<HTMLElement>(rowSelector);
    const anchor = anchorRef.current;
    if (!row || !anchor) return;
    const open = (event: MouseEvent) => {
      if (event.target === anchor || event.defaultPrevented || isEditable(event.target)) return;
      event.preventDefault();
      // A keyboard's menu key reports no pointer, so the menu opens under the row instead.
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const box = row.getBoundingClientRect();
      anchor.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: keyboard ? box.left + 8 : event.clientX,
          clientY: keyboard ? box.bottom : event.clientY,
        }),
      );
    };
    row.addEventListener("contextmenu", open);
    return () => row.removeEventListener("contextmenu", open);
  }, []);

  const changeMenu = (open: boolean) => {
    setMenuOpen(open);
    onOpenChange?.(open || contextOpen);
  };
  const changeContext = (open: boolean) => {
    setContextOpen(open);
    onOpenChange?.(open || menuOpen);
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={changeMenu}>
        <DropdownMenuTrigger asChild>
          <IconButton
            ref={buttonRef}
            label={label}
            size="sm"
            variant="quiet"
            data-slot="row-actions"
            data-context-open={contextOpen || undefined}
            className={cn(
              "opacity-0 transition-opacity focus-visible:opacity-100",
              "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
              "data-[state=open]:opacity-100 data-[context-open]:opacity-100",
              className,
            )}
            // The row is often a link or button of its own; the ⋯ must not open it too.
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={width} aria-label={label}>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      <ContextMenu onOpenChange={changeContext}>
        <ContextMenuTrigger asChild>
          <span ref={anchorRef} aria-hidden className="hidden" />
        </ContextMenuTrigger>
        <ContextMenuContent width={width} aria-label={label}>
          {children}
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

export { RowActions };
export type { RowActionsProps };
