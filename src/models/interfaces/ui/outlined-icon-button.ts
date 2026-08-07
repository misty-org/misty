import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconButton as PrimitiveIconButton } from "@/ui";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}
