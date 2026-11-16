import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PlaceChip, spaceIcons } from "@/shared/ui";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { HomeSection } from "./HomeSection";
import { homeChipsClass } from "./homeLayout";

/** A page is a section of the Space. */
const places: { section: string; label: string; icon: LucideIcon }[] = [
  { section: "chat", label: "Chat", icon: spaceIcons.chat },
  { section: "notes", label: "Docs", icon: spaceIcons.docs },
  // The Lab's notebooks save into their agent's Space, so the Lab is one of its pages.
  { section: "lab", label: "Lab", icon: spaceIcons.lab },
  { section: "planner", label: "Planner", icon: spaceIcons.planner },
  { section: "calendar", label: "Calendar", icon: spaceIcons.calendar },
  { section: "library", label: "Library", icon: spaceIcons.library },
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
