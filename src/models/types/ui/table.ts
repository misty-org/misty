import * as React from "react";
import { cn } from "@/ui";

export type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  unwrapped?: boolean;
};
