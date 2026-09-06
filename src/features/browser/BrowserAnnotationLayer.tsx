import { useCallback, type ComponentProps } from "react";
import { registerShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceTabFocused } from "@/features/workspace";
import { BrowserAnnotationLayerView } from "./BrowserAnnotationLayerView";
export * from "./BrowserAnnotationLayerView";
export function BrowserAnnotationLayer(
  props: Omit<ComponentProps<typeof BrowserAnnotationLayerView>, "registerCommand">,
) {
  const focused = useWorkspaceTabFocused();
  const registerCommand = useCallback(
    (
      command: "browser.annotation_undo" | "browser.annotation_redo",
      action: () => void,
      enabled: () => boolean,
    ) =>
      registerShortcutHandler(
        command,
        () => {
          action();
          return true;
        },
        () => focused && enabled(),
      ),
    [focused],
  );
  return <BrowserAnnotationLayerView {...props} registerCommand={registerCommand} />;
}
