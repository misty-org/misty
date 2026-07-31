import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, cn } from "@/ui";

export const spacesBottomBarActionsId = "misty-spaces-bottom-bar-actions";

export function SpacesBottomBarActionsPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(spacesBottomBarActionsId));
  }, []);

  return target ? createPortal(children, target) : null;
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
        pressed ? "text-foreground" : "text-muted-foreground hover:text-foreground",
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
