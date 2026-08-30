import { useShortcutHandler } from "@/features/shortcuts";

/** Press "c" anywhere outside a text field to open the new-task drawer. */
export function useCreateTaskShortcut(enabled: boolean, onCreate: () => void) {
  useShortcutHandler("planner.create", onCreate, enabled);
}
