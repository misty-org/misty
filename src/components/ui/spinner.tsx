import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type SpinnerProps = React.HTMLAttributes<HTMLSpanElement> & {
  label?: string;
  size?: "sm" | "default" | "lg";
};

function Spinner({ className, label = "Loading", size = "default", ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-current",
        size === "sm" && "size-3.5",
        size === "default" && "size-4",
        size === "lg" && "size-5",
        className,
      )}
      {...props}
    >
      <LoaderCircle aria-hidden="true" className="size-full animate-spin" />
    </span>
  );
}

export { Spinner, type SpinnerProps };
