import { LoaderCircle } from "lucide-react";
import * as React from "react";

import { cn } from "../utils";

/** The one loading indicator. Spinning refresh or retry glyphs are icon states, not loaders. */
function Spinner({ className, label = "Loading", size = "default", ...props }: SpinnerProps) {
  return (
    <span
      role={label === false ? undefined : "status"}
      aria-label={label === false ? undefined : label}
      aria-hidden={label === false ? true : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-current",
        size === "sm" && "size-3.5",
        size === "default" && "size-4",
        size === "lg" && "size-5",
        className,
      )}
      {...props}
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-full animate-spin motion-reduce:animate-none"
      />
    </span>
  );
}
export { Spinner };

export type SpinnerProps = React.HTMLAttributes<HTMLSpanElement> & {
  /** Announced loading label; false when nearby text already says what is loading. */
  label?: string | false;
  size?: "sm" | "default" | "lg";
};
