import { Compass } from "lucide-react";
import { InfoCorner } from "@/shared/ui";
import { startTour, useTours } from "./tourStore";
import { tours, type TourId } from "./tours";

/**
 * The "i" that replays a tour: the window's bottom bar holds the focused pane's, and a popup with
 * a tour keeps its own in its bottom-right corner, so a popup over a page replays its own and not
 * the one behind it. More help about the surface can join its panel later.
 *
 * Features outside onboarding import it from this file rather than `@/features/onboarding`, so
 * the agents feature (which onboarding's setup uses) doesn't import itself back.
 */
export function TourInfoButton({ tour }: { tour: TourId }) {
  // It steps aside while any tour is running.
  const touring = useTours((state) => state.active !== null);
  if (touring) return null;
  return (
    <InfoCorner
      label="About this page"
      title={tours[tour].label}
      body="A short walk through what's here."
      action={{ label: "Replay tour", icon: Compass, onSelect: () => startTour(tour) }}
    />
  );
}
