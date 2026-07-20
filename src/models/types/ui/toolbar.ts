import * as React from "react";
import { cn } from "@/ui";

export type ToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
  variant?: "default" | "floating" | "bare";
  wrap?: boolean;
};

export type ToolbarGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  align?: "start" | "end";
  separated?: boolean;
};
