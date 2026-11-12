import { X } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";
import { IconButton } from "../controls/IconButton";
import { OverflowFadeText } from "./OverflowFadeText";

export type FloatingPanelAnchor =
  "top-left" | "top-right" | "bottom-left" | "bottom-right" | "free";

export type FloatingPanelProps = {
  title?: string;
  /**
   * The panel's own controls in its header, before the close button: a few 24px quiet
   * IconButtons or one MenuTrigger (`size="sm"`), such as a filter or a ⋯ menu.
   */
  actions?: React.ReactNode;
  /**
   * The corner of the Studio it floats in, 12px from the edges. `free` leaves placement to the
   * parent, e.g. a stack of panels in one corner.
   */
  anchor: FloatingPanelAnchor;
  /** Shows a close button, and Escape inside the panel closes it. */
  onClose?: () => void;
  /** sm 256, md 320 (default), lg 384. */
  width?: "sm" | "md" | "lg";
  children: React.ReactNode;
  /** Layout only: margins or placement. */
  className?: string;
};

const anchorClass: Record<FloatingPanelAnchor, string> = {
  "top-left": "absolute top-3 left-3",
  "top-right": "absolute top-3 right-3",
  "bottom-left": "absolute bottom-3 left-3",
  "bottom-right": "absolute bottom-3 right-3",
  free: "relative",
};

const widthClass = { sm: "w-64", md: "w-80", lg: "w-96" } as const;

/**
 * A translucent panel floating over the Studio's office, which shows through it blurred. Only the
 * Studio (src/features/agents/virtual) uses it: everywhere else panes are flat. The content may
 * be in full color. It is no dialog: it doesn't trap focus or block the office behind it.
 */
export function FloatingPanel({
  title,
  actions,
  anchor,
  onClose,
  width = "md",
  children,
  className,
}: FloatingPanelProps) {
  const hasHeader = Boolean(title || onClose || actions);
  return (
    <section
      aria-label={title}
      data-slot="floating-panel"
      // Takes the popup edge from overlays.css, and its clipping to the rounded corners.
      data-popup-surface=""
      className={cn(
        anchorClass[anchor],
        widthClass[width],
        "flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col",
        "rounded-xl bg-charcoal-card/72 text-cream shadow-lg backdrop-blur-md",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !onClose || event.defaultPrevented) return;
        // A menu portaled out of the panel bubbles here too; its Escape only closes the menu.
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.stopPropagation();
        onClose();
      }}
    >
      {hasHeader ? (
        <div className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
          {title ? (
            <OverflowFadeText
              as="h2"
              full
              className="m-0 flex-1 text-control font-medium text-cream-bright"
            >
              {title}
            </OverflowFadeText>
          ) : (
            <span className="flex-1" />
          )}
          {actions ? (
            <div data-slot="floating-panel-actions" className="flex shrink-0 items-center gap-1">
              {actions}
            </div>
          ) : null}
          {onClose ? (
            <IconButton label="Close" size="sm" variant="quiet" onClick={onClose}>
              <X aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      ) : null}
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-3 pb-3", !hasHeader && "pt-3")}>
        {children}
      </div>
    </section>
  );
}
