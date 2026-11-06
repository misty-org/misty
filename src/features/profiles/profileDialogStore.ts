import { create } from "zustand";
import { useProfileWindowStore, type ProfileEntry } from "@/features/workspace/profileWindow";

export type ProfileDialog = "create" | "rename" | "color" | "sites" | "delete";

/**
 * Which of the profile dialogs is open, and for which profile. The account menu, the app menu and
 * the sidebar's profile buttons all open them.
 */
export const useProfileDialogs = create<{
  open: ProfileDialog | null;
  /** The profile being edited. `null` is this window's. */
  target: string | null;
  show(dialog: ProfileDialog, target?: string): void;
  close(): void;
}>((set) => ({
  open: null,
  target: null,
  show: (open, target) => set({ open, target: target ?? null }),
  close: () => set({ open: null, target: null }),
}));

/** The profile an open dialog edits: the one it was opened for, or this window's. */
export function useDialogProfile(): ProfileEntry {
  const target = useProfileDialogs((state) => state.target);
  const current = useProfileWindowStore((state) => state.profile);
  const listed = useProfileWindowStore((state) =>
    state.profiles.find((profile) => profile.id === target),
  );
  return listed ?? current;
}
