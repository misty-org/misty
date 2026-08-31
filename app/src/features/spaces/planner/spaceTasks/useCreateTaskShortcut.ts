import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceTabFocused } from "@/features/workspace";

/** Press "c" anywhere outside a text field to open the new-task drawer. */
export function useCreateTaskShortcut(enabled: boolean, onCreate: () => void) {
  const focused = useWorkspaceTabFocused();
  useShortcutHandler("planner.create", onCreate, enabled && focused);
}
