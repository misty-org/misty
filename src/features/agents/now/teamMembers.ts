import { create } from "zustand";

/** Another member of the Space this window shows, as the Space's live presence last said. */
export interface TeamMember {
  userId: string;
  name: string;
  /** Their own profile picture, when they have one (an object URL). */
  picture?: string;
  /** Where in Misty they are: the Lab, or elsewhere in the Space. */
  place?: "lab";
  /** The Lab notebook they have open, by its name, when they are in one. */
  notebook?: string;
  /** That notebook's doc id, so the Lab can show them on its card. */
  notebookDoc?: string;
  /** Whether Misty has their focus right now. */
  active: boolean;
}

/** Where a member is, in a few words for their row. */
export function placeWords(member: Pick<TeamMember, "place" | "notebook">): string {
  if (member.place === "lab")
    return member.notebook ? `In the Lab · ${member.notebook}` : "In the Lab";
  return "In the Space";
}

/** The member's initial, for an avatar with no picture. */
export const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/**
 * The other members in the Space this window shows. Spaces fills this in from the Space's live
 * presence while something that shows them is open (`useStudioOpen`). Nothing here is sent anywhere.
 */
export const useTeamMembers = create<{
  members: TeamMember[];
  show(members: TeamMember[]): void;
}>((set) => ({
  members: [],
  show: (members) => set({ members }),
}));

/**
 * How many things in this window show the Space's members right now (the Lab), so Spaces only
 * follows the Space's presence while someone is looking.
 */
export const useStudioOpen = create<{ open: number; enter(): () => void }>((set) => ({
  open: 0,
  enter: () => {
    set((state) => ({ open: state.open + 1 }));
    return () => set((state) => ({ open: Math.max(0, state.open - 1) }));
  },
}));
