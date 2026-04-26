import * as React from "react";
import { cn } from "@/ui";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  size?: "default" | "sm";
};
