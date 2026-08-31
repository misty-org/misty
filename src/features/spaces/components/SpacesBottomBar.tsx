import { Button, cn, PortalToId } from "@/shared/ui";
import type { ReactNode } from "react";

export const spacesBottomBarActionsId = "misty-spaces-bottom-bar-actions";

export function SpacesBottomBarActionsPortal({ children }: { children: ReactNode }) {
  return <PortalToId targetId={spacesBottomBarActionsId}>{children}</PortalToId>;
}

export function SpacesBottomBarToggle({
  pressed,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      className={cn(
        "size-7 rounded-md !bg-transparent p-0 hover:!bg-transparent active:!bg-transparent aria-pressed:!bg-transparent",
        pressed ? "text-cream" : "text-cream-muted hover:text-cream",
      )}
      size="icon"
      variant="ghost"
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
    >
      {children}
    </Button>
  );
}
