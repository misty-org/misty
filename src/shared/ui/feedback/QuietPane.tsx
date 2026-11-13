import { cn } from "../classNames";
import { FlyingMisty } from "./FlyingMisty";

/**
 * Wherever there is nothing to show yet: Misty flying around the box behind one line. The startup
 * splash and an empty pane are this same view, so one hands over to the other without a change.
 */
export function QuietPane(props: { className?: string }) {
  return (
    <div
      className={cn(
        "relative grid size-full place-items-center bg-charcoal-bg px-6 text-center",
        props.className,
      )}
    >
      <FlyingMisty />
      <p className="relative z-10 m-0 text-base font-medium text-cream">A little quiet here…</p>
    </div>
  );
}
