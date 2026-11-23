import { LayoutPanelLeft } from "lucide-react";
import { useLayoutEditor } from "@/features/app-windows";
import { IconButton } from "@misty/ui";

export function LayoutButton() {
  const active = useLayoutEditor((state) => state.active);
  return (
    <IconButton
      label="Layout"
      aria-pressed={active}
      onClick={() => useLayoutEditor.getState().toggle()}
    >
      <LayoutPanelLeft />
    </IconButton>
  );
}
