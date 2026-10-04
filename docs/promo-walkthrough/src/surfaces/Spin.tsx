import { LoaderCircle } from "lucide-react";

/** A spinner driven by film time rather than a CSS animation, so frames are reproducible. */
export function Spin({ t, className = "size-4" }: { t: number; className?: string }) {
  return (
    <LoaderCircle
      className={`${className} shrink-0 text-cream-muted`}
      style={{ transform: `rotate(${(t * 900) % 360}deg)` }}
      aria-hidden
    />
  );
}
