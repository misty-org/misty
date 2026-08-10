import type * as React from "react";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  size?: "default" | "sm";
};
