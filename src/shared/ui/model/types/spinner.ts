import type * as React from "react";

export type SpinnerProps = React.HTMLAttributes<HTMLSpanElement> & {
  label?: string;
  size?: "sm" | "default" | "lg";
};
