import {
  CalendarDays,
  MessagesSquare,
  KanbanSquare,
  Library,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { OverflowFadeText, Pressable } from "@/shared/ui";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { HomeSection } from "./HomeSection";

const places: { section: string; label: string; icon: LucideIcon }[] = [
  { section: "chat", label: "Chat", icon: MessagesSquare },
  { section: "notes", label: "Journal", icon: NotebookPen },
  { section: "planner", label: "Planner", icon: KanbanSquare },
  { section: "calendar", label: "Calendar", icon: CalendarDays },
  { section: "library", label: "Library", icon: Library },
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
      <div className="home-places">
        {places.map(({ section, label, icon: Icon }) => (
          <Pressable
            key={section}
            onPointerEnter={() => void preloadSpaceSection(section).catch(() => undefined)}
            onClick={() => navigate(`${base}/${section}`)}
            className="home-place"
          >
            <span className="home-place-icon" aria-hidden>
              <Icon className="size-4" />
            </span>
            <OverflowFadeText>{label}</OverflowFadeText>
          </Pressable>
        ))}
      </div>
    </HomeSection>
  );
}
