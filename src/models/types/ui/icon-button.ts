import * as React from "react";
import { Button } from "@/ui";
import type { ButtonProps } from "@/models/interfaces/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui";
import { cn } from "@/ui";

export type IconButtonProps = Omit<ButtonProps, "asChild" | "size"> & {
  children: React.ReactNode;
  label: string;
  tooltip?: string | false;
  size?: "sm" | "default" | "lg";
};
