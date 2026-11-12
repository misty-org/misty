import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { OverflowFadeText, Pressable } from "@/shared/ui";

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
    <Pressable
      ref={ref}
      type="button"
      className="misty-space-nav-row"
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={shortcut}
      onClick={onOpen}
      {...props}
    >
      {icon ? <span className="misty-space-nav-icon">{icon}</span> : null}
      <OverflowFadeText>{label}</OverflowFadeText>
      {shortcut ? (
        <kbd className="misty-space-nav-key">{shortcut.replace("Meta+", "⌘")}</kbd>
      ) : null}
    </Pressable>
  );
});
