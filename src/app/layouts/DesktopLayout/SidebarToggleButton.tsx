import { PanelLeft, PanelRight } from "lucide-react";
import { IconButton } from "@misty/ui";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { useSidebarCollapsedStore } from "../../shell/sidebar_collapsed";

export function SidebarToggleButton({ side = "left" }: { side?: "left" | "right" }) {
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);
  const Icon = side === "left" ? PanelLeft : PanelRight;
  return (
    <IconButton
      label={collapsed ? "Show sidebar" : "Hide sidebar"}
      onClick={() => {
        setBrowserWebviewsSuspended(true, "sidebar-toggle");
        window.setTimeout(() => setBrowserWebviewsSuspended(false, "sidebar-toggle"), 340);
        useSidebarCollapsedStore.getState().toggle();
      }}
    >
      <Icon />
    </IconButton>
  );
}
