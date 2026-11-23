import { create } from "zustand";

export interface TeamMember {
  userId: string;
  name: string;
  picture?: string;
  place?: "lab";
  notebook?: string;
  notebookDoc?: string;
  active: boolean;
}

export function placeWords(member: Pick<TeamMember, "place" | "notebook">): string {
  if (member.place === "lab")
    return member.notebook ? `In ${member.notebook} in the Lab` : "In the Lab";
  return "In the Space";
}

export const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export const useTeamMembers = create<{
  members: TeamMember[];
  show(members: TeamMember[]): void;
}>((set) => ({
  members: [],
  show: (members) => set({ members }),
}));

export const useStudioOpen = create<{ open: number; enter(): () => void }>((set) => ({
  open: 0,
  enter: () => {
    set((state) => ({ open: state.open + 1 }));
    return () => set((state) => ({ open: Math.max(0, state.open - 1) }));
  },
}));
