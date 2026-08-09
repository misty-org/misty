import type * as React from "react";

export type ToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
  variant?: "default" | "floating" | "bare";
  wrap?: boolean;
};

export type ToolbarGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  align?: "start" | "end";
  separated?: boolean;
};
