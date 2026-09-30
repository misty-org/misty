import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/workspace";

/** Press "c" anywhere outside a text field to open the new-task drawer. */
export function useCreateTaskShortcut(enabled: boolean, onCreate: () => void) {
  const focused = useWorkspaceViewFocused();
  useShortcutHandler("planner.create", onCreate, enabled && focused);
}
