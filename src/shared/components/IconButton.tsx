import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconButton as PrimitiveIconButton } from "@/components/ui/icon-button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function IconButton({
  children,
  title,
  "aria-label": ariaLabel,
  ...buttonProps
}: IconButtonProps) {
  const label = ariaLabel ?? (typeof title === "string" ? title : "Action");
  return (
    <PrimitiveIconButton
      label={label}
      tooltip={typeof title === "string" ? title : label}
      variant="outline"
      {...buttonProps}
    >
      {children}
    </PrimitiveIconButton>
  );
}
