import { Compass } from "lucide-react";
import { InfoCorner } from "@misty/ui";
import { startTour, useTours } from "./tour_store";
import { tours, type TourId } from "./tours";

export function TourInfoButton({ tour }: { tour: TourId }) {
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
