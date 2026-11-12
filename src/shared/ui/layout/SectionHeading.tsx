import { ChevronRight, type LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import { DropdownMenu, DropdownMenuContent } from "../overlays/DropdownMenu";
import { MenuTrigger } from "../overlays/MenuTrigger";
import { OverflowFadeText } from "./OverflowFadeText";

/**
 * A section heading's one action. With `icon` and no `showLabel` it is a 24px quiet IconButton
 * whose label is its tooltip; with `showLabel` (or no icon) a 24px quiet Button. With `menu` it
 * opens those MenuItem rows instead of calling `onSelect`.
 */
export type SectionHeadingAction = {
  label: string;
  icon?: LucideIcon;
  /** Shows the label beside the icon. Without an icon the label always shows. */
  showLabel?: boolean;
  onSelect?: () => void;
  /** MenuItem rows the action opens, such as the kinds of chat to start. */
  menu?: React.ReactNode;
  disabled?: boolean;
};

export type SectionHeadingProps = {
  title: string;
  /** A quiet count after the title, such as the number of chats in the section. */
  count?: number;
  action?: SectionHeadingAction;
  /**
   * Makes the title a fold button with a chevron. Controlled: pass both, and render the section's
   * content only while `open`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The id of the content the fold shows and hides. */
  controls?: string;
  /** The heading level. Defaults to h2. */
  as?: "h2" | "h3";
  id?: string;
  /** Layout only: margins or placement. */
  className?: string;
};

/**
 * The heading over a group of rows: a Space home section, the sidebar's chat sections, a chat's
 * Channels and Direct messages. Plain muted text, not a chip, 32px tall and aligned with the rows
 * under it, with an optional count, one action at the right end and an optional fold. Only the
 * fold button washes on hover.
 *
 * ```tsx
 * <SectionHeading title="Channels" count={channels.length} open={open} onOpenChange={setOpen}
 *   controls="channels" action={{ label: "New channel", icon: Plus, onSelect: create }} />
 * ```
 */
export function SectionHeading({
  title,
  count,
  action,
  open,
  onOpenChange,
  controls,
  as: Heading = "h2",
  id,
  className,
}: SectionHeadingProps) {
  const folds = open !== undefined && onOpenChange !== undefined;
  const words = (
    <>
      <OverflowFadeText full className="min-w-0">
        {title}
      </OverflowFadeText>
      {/* A space for the accessible name ("Chats 4"); flex drops it visually. */}
      {count !== undefined ? " " : null}
      {count !== undefined ? (
        <span className="shrink-0 tabular-nums text-cream-muted/70">{count}</span>
      ) : null}
    </>
  );
  return (
    <div
      data-slot="section-heading"
      className={cn("flex h-8 min-w-0 items-center gap-2 pr-2", folds ? "pl-0" : "pl-2", className)}
    >
      <Heading id={id} className="m-0 flex min-w-0 flex-1 text-meta font-medium text-cream-muted">
        {folds ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={controls}
            onClick={() => onOpenChange(!open)}
            className={cn(
              "flex h-6 min-w-0 max-w-full items-center gap-1 rounded-sm px-2 text-left outline-none",
              "transition-colors hover:bg-control-hover hover:text-cream",
              "focus-visible:bg-control-hover focus-visible:text-cream",
            )}
          >
            {words}
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1">{words}</span>
        )}
      </Heading>
      {action ? <HeadingAction action={action} /> : null}
    </div>
  );
}

function HeadingAction({ action }: { action: SectionHeadingAction }) {
  const iconOnly = Boolean(action.icon) && !action.showLabel;
  if (action.menu)
    return (
      <DropdownMenu modal={false}>
        <MenuTrigger
          label={action.label}
          icon={action.icon}
          iconOnly={iconOnly}
          chevron={false}
          size="sm"
          disabled={action.disabled}
        />
        <DropdownMenuContent align="end" width="md">
          {action.menu}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  if (iconOnly && action.icon) {
    const Icon = action.icon;
    return (
      <IconButton
        label={action.label}
        size="sm"
        variant="quiet"
        disabled={action.disabled}
        onClick={action.onSelect}
      >
        <Icon aria-hidden="true" />
      </IconButton>
    );
  }
  return (
    <Button
      size="sm"
      variant="quiet"
      icon={action.icon}
      disabled={action.disabled}
      onClick={action.onSelect}
    >
      {action.label}
    </Button>
  );
}
