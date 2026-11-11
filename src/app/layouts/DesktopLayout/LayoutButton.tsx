import { LayoutPanelLeft } from "lucide-react";
import { useLayoutEditor } from "@/features/app-windows";
import { IconButton, toolbarIconProps } from "@/shared/ui";

/** Turns layout mode on or off: split and join the window's pages over the live page. */
export function LayoutButton() {
  const active = useLayoutEditor((state) => state.active);
  return (
    <IconButton
      label="Layout"
      aria-pressed={active}
      onClick={() => useLayoutEditor.getState().toggle()}
    >
      <LayoutPanelLeft {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
}
