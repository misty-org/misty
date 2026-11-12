import { PanelLeft, PanelRight } from "lucide-react";
import { IconButton } from "@/shared/ui";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { useSidebarCollapsedStore } from "../../shell/sidebarCollapsed";

/** Hides or shows the sidebar. */
export function SidebarToggleButton({ side = "left" }: { side?: "left" | "right" }) {
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);
  const Icon = side === "left" ? PanelLeft : PanelRight;
  return (
    <IconButton
      label={collapsed ? "Show sidebar" : "Hide sidebar"}
      size="sm"
      className="size-7"
      onClick={() => {
        // Native pages sit above the app, so they step aside while the drawer slides.
        setBrowserWebviewsSuspended(true, "sidebar-toggle");
        window.setTimeout(() => setBrowserWebviewsSuspended(false, "sidebar-toggle"), 340);
        useSidebarCollapsedStore.getState().toggle();
      }}
    >
      <Icon />
    </IconButton>
  );
}
