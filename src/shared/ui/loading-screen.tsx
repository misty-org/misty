import { cn } from "./utils";

/** Quiet surface for initial loads and route transitions. */
export function LoadingScreen({
  label = "Loading",
  className,
  fullScreen = false,
}: {
  label?: string;
  className?: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      className={cn(
        "h-full min-h-0 w-full flex-1",
        className,
        "bg-black",
        fullScreen && "fixed inset-0 z-50",
      )}
      role="status"
      aria-label={label}
      aria-busy="true"
    />
  );
}
