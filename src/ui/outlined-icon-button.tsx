import type { IconButtonProps } from "@/models/interfaces/ui/outlined-icon-button";
export type { IconButtonProps } from "@/models/interfaces/ui/outlined-icon-button";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconButton as PrimitiveIconButton } from "./icon-button";

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
