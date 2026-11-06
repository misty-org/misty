import { Brain } from "lucide-react";
import { IconButton, toolbarIconProps } from "@/shared/ui";

/** The Memory icon in the Space bar: it opens the Space's memory tree. */
export function MemoryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <IconButton label="Memory" onClick={onOpen}>
      <Brain {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
}
