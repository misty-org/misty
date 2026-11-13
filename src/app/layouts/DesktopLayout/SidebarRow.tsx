import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Kbd, NavRow, OverflowFadeText } from "@/shared/ui";
import { markSlotClass } from "./styles";

/** One row of the sidebar's places: an icon, a label and, for some, a key hint. */
export const SidebarRow = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<"button">, "children"> & {
    current?: boolean;
    icon?: ReactNode;
    label: string;
    shortcut?: string;
    onOpen?(): void;
  }
>(function SidebarRow({ current, icon, label, shortcut, onOpen, ...props }, ref) {
  return (
    <NavRow ref={ref} current={current} aria-keyshortcuts={shortcut} onClick={onOpen} {...props}>
      {icon ? <span className={markSlotClass}>{icon}</span> : null}
      <OverflowFadeText>{label}</OverflowFadeText>
      {shortcut ? (
        // A key hint, as in "Search ⌘K". A narrow sidebar drops it; the row keeps its label.
        <Kbd size="micro" outline={false} className="ml-auto @max-[230px]/misty-sidebar:hidden">
          {shortcut.replace("Meta+", "⌘")}
        </Kbd>
      ) : null}
    </NavRow>
  );
});
