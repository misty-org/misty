import type { ButtonProps } from "@/shared/ui/model/interfaces/button";
import type * as React from "react";

export type IconButtonProps = Omit<ButtonProps, "asChild" | "size"> & {
  children: React.ReactNode;
  label: string;
  tooltip?: string | false;
  size?: "sm" | "default" | "lg";
};
