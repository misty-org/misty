import type { ReactNode } from "react";
import { Button } from "../controls/Button";
import { MenuTrigger } from "./MenuTrigger";

/**
 * A shell pill split in two: the icon and label do the direct action, the chevron opens the
 * DropdownMenu it sits in. Place it as the menu's trigger, inside `DropdownMenu`.
 */
export function SplitMenuPill(props: {
  icon: ReactNode;
  label: string;
  /** Accessible name and tooltip for the direct action. */
  actionLabel: string;
  /** Accessible name for the chevron. */
  menuLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="group/pill inline-flex min-w-0 items-center rounded-lg bg-cream/[0.07]">
      <Button
        type="button"
        variant="ghost"
        size="none"
        className="!h-[var(--shell-tab-height,36px)] min-w-0 max-w-full gap-2 rounded-l-lg rounded-r-none bg-transparent pl-2.5 pr-1.5 hover:bg-cream/[0.08]"
        aria-label={props.actionLabel}
        title={props.actionLabel}
        onClick={props.onAction}
      >
        {props.icon}
        <span className="min-w-0 truncate">{props.label}</span>
      </Button>
      <MenuTrigger
        iconOnly
        showChevron
        size="xs"
        label={props.menuLabel}
        tooltip={false}
        className="!h-[var(--shell-tab-height,36px)] !w-auto rounded-l-none rounded-r-lg bg-transparent pl-1 pr-2 hover:bg-cream/[0.08]"
      />
    </div>
  );
}
