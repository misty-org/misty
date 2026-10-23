import { Brain } from "lucide-react";
import { publicBetaFeatureEnabled } from "@/features/launch";
import { useScreenCaptureStore } from "@/features/screen-memory";
import { IconButton, toolbarIconProps } from "@/shared/ui";

/**
 * The Memory icon in the Space bar: it opens the Space's memory tree. While a capture session
 * runs the icon is pressed and says so; the session itself is started and stopped in the tree.
 */
export function MemoryButton({ onOpen }: { onOpen: () => void }) {
  const running = useScreenCaptureStore((s) => s.running);
  const frames = useScreenCaptureStore((s) => s.frames);
  if (!publicBetaFeatureEnabled("recall")) return null;
  return (
    <IconButton
      label={running ? `Memory, capturing ${frames} screens` : "Memory"}
      aria-pressed={running}
      className={running ? "w-auto gap-1.5 px-2" : undefined}
      onClick={onOpen}
    >
      <Brain {...toolbarIconProps} className="size-4" />
      {running && <span className="text-xs text-cream-muted">Capturing</span>}
    </IconButton>
  );
}
