import {
  BookOpen,
  Bookmark,
  Briefcase,
  CalendarHeart,
  FlaskConical,
  Gamepad2,
  GraduationCap,
  House,
  Palette,
  Plane,
  Rocket,
  Square,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { SpaceTemplate } from "@/api/spaces/dto/entities";

/** Template icon keys from the server, drawn as monochrome glyphs. */
const icons: Record<string, LucideIcon> = {
  square: Square,
  rocket: Rocket,
  flask: FlaskConical,
  "graduation-cap": GraduationCap,
  palette: Palette,
  gamepad: Gamepad2,
  users: Users,
  plane: Plane,
  "calendar-heart": CalendarHeart,
  briefcase: Briefcase,
  home: House,
  "book-open": BookOpen,
  bookmark: Bookmark,
};

export function templateIcon(key: string): LucideIcon {
  return icons[key] ?? Square;
}

/** Offered even when the template list can't load, so creating never depends on it. */
export const blankTemplate: SpaceTemplate = {
  id: "blank",
  name: "Blank",
  description: "Start with an empty Space.",
  version: 1,
  icon: "square",
  suggested_name: "",
  seed_summary: { task_count: 0, note_count: 0, collection_count: 0 },
  seed_preview: { tasks: [], notes: [], collections: [] },
};

export function seedCounts(template: SpaceTemplate): string {
  const {
    task_count: tasks,
    note_count: notes,
    collection_count: collections,
  } = template.seed_summary;
  const parts = [
    tasks ? `${tasks} task${tasks === 1 ? "" : "s"}` : "",
    notes ? `${notes} note${notes === 1 ? "" : "s"}` : "",
    collections ? `${collections} collection${collections === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing added";
}
