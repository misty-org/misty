import { LayoutPanelLeft } from "lucide-react";
import { useLayoutEditor } from "@/features/app-windows";
import { IconButton } from "@/shared/ui";

/** Opens the layout picker, which splits and joins the current tab's pages. It sits at the far end
 * of the tab row. */
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
