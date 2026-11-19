import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PlaceChip, spaceIcons, spaceMadeKinds } from "@/shared/ui";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { HomeSection } from "./HomeSection";
import { homeChipsClass } from "./homeLayout";

/**
 * A page is a section of the Space. The Space's chat isn't one: it is a place, reached by its
 * icon in the home's bar.
 */
const places: { section: string; label: string; icon: LucideIcon }[] = [
  ...spaceMadeKinds.map(({ section, page, pageIcon }) => ({
    section,
    label: page,
    icon: pageIcon,
  })),
  // The Lab's notebooks save into their agent's Space, so the Lab is one of its pages.
  { section: "lab", label: "Lab", icon: spaceIcons.lab },
  { section: "planner", label: "Planner", icon: spaceIcons.planner },
  { section: "calendar", label: "Calendar", icon: spaceIcons.calendar },
  { section: "media", label: "Media", icon: spaceIcons.media },
];

/**
 * The Space's own pages, one chip each, so the sidebar needs only one row for all of them. The
 * icons stay neutral: the names tell the pages apart.
 */
export function SpacePlaces({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const base = `/spaces/${encodeURIComponent(spaceId)}`;
  return (
    <HomeSection title="Pages">
      <div className={homeChipsClass}>
        {places.map(({ section, label, icon }) => (
          <PlaceChip
            key={section}
            icon={icon}
            label={label}
            onPointerEnter={() => void preloadSpaceSection(section).catch(() => undefined)}
            onClick={() => navigate(`${base}/${section}`)}
          />
        ))}
      </div>
    </HomeSection>
  );
}
