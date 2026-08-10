import { NavLink } from "react-router";

/**
 * "Space" in the hero, rendered as a link to the Spaces explainer.
 * The resting underline is a static bar so the affordance survives the global
 * `animation: none` under prefers-reduced-motion (see src/index.css).
 */
export function SpacesLink({ children }: { children: string }) {
  return (
    <NavLink
      to="/features#spaces"
      className="relative inline-block rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-[0.06em] h-[0.055em] overflow-hidden rounded-full"
      >
        <span className="absolute inset-0 bg-foreground/45" />
        <span className="absolute inset-0 animate-[underline-sweep_3.2s_ease-in-out_infinite] bg-foreground" />
      </span>
    </NavLink>
  );
}
