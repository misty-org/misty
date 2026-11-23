import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useShortcutLabel } from "@/features/shortcuts";
import { cn, Kbd, NavRow, OverflowFadeText } from "@misty/ui";
import { markSlotClass } from "./styles";

export function SidebarShortcut({ command }: { command: string }) {
  const label = useShortcutLabel(command);
  if (!label) return null;
  return (
    <Kbd
      size="micro"
      outline={false}
      className={cn(
        "ml-auto opacity-0 transition-opacity @max-[14.375rem]/misty-sidebar:hidden",
        "group-hover/nav-row:opacity-100 group-focus-visible/nav-row:opacity-100",
      )}
    >
      {label}
    </Kbd>
  );
}

export const SidebarRow = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<"button">, "children"> & {
    current?: boolean;
    icon?: ReactNode;
    label: string;
    command?: string;
    onOpen?(): void;
  }
>(function SidebarRow({ current, icon, label, command, onOpen, ...props }, ref) {
  return (
    <NavRow ref={ref} current={current} onClick={onOpen} {...props}>
      {icon ? <span className={markSlotClass}>{icon}</span> : null}
      <OverflowFadeText>{label}</OverflowFadeText>
      {command ? <SidebarShortcut command={command} /> : null}
    </NavRow>
  );
});
