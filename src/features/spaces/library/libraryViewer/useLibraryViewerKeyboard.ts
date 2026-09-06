import { useEffect } from "react";
import { useLibraryFocused as useWorkspaceTabFocused } from "@/features/spaces/library/libraryRuntime";

const TEXT_ENTRY_SELECTOR = "input, textarea, select, [contenteditable='true']";

/**
 * Escape closes and arrow keys page through items.
 *
 * Disabled while an image is open, because that path renders the photo editor,
 * which binds its own shortcuts.
 */
export function useLibraryViewerKeyboard(options: {
  enabled: boolean;
  index: number;
  itemCount: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { enabled, index, itemCount, onClose, onPrevious, onNext } = options;
  const workspaceFocused = useWorkspaceTabFocused();

  useEffect(() => {
    if (!enabled || !workspaceFocused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches(TEXT_ENTRY_SELECTOR)) return;
      if (event.key === "ArrowLeft" && index > 0) onPrevious();
      if (event.key === "ArrowRight" && index >= 0 && index < itemCount - 1) onNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, index, itemCount, onClose, onNext, onPrevious, workspaceFocused]);
}
