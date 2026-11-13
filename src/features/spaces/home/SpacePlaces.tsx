import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Pressable, Surface, Text, spaceIcons } from "@/shared/ui";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { HomeSection } from "./HomeSection";
import { homePlaceClass, homePlacesClass } from "./homeLayout";

const places: { section: string; label: string; icon: LucideIcon }[] = [
  { section: "chat", label: "Chat", icon: spaceIcons.chat },
  { section: "notes", label: "Docs", icon: spaceIcons.docs },
  { section: "planner", label: "Planner", icon: spaceIcons.planner },
  { section: "calendar", label: "Calendar", icon: spaceIcons.calendar },
  { section: "library", label: "Library", icon: spaceIcons.library },
];

/**
 * The Space's own pages, one slim tile each, so the sidebar needs only one row for all of them.
 * The icons stay neutral: the names tell the pages apart.
 */
export function SpacePlaces({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const base = `/spaces/${encodeURIComponent(spaceId)}`;
  return (
    <HomeSection title="Pages">
      <div className={homePlacesClass}>
        {places.map(({ section, label, icon: Icon }) => (
          <Surface
            as={Pressable}
            key={section}
            tone="card"
            edge="hairline"
            radius="xl"
            wash="card"
            onPointerEnter={() => void preloadSpaceSection(section).catch(() => undefined)}
            onClick={() => navigate(`${base}/${section}`)}
            className={homePlaceClass}
          >
            <PlaceIconTile>
              <Icon />
            </PlaceIconTile>
            <Text tone="default">{label}</Text>
          </Surface>
        ))}
      </div>
    </HomeSection>
  );
}

/** The quiet neutral square a page tile's icon sits on. */
export function PlaceIconTile({ children }: { children?: ReactNode }) {
  return (
    <Surface
      as="span"
      tone="faint"
      radius="lg"
      aria-hidden
      className="grid size-7 shrink-0 place-items-center"
    >
      <Text bare tone="muted" className="contents">
        {children}
      </Text>
    </Surface>
  );
}
