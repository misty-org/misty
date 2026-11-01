import { PanelLeft, PanelRight } from "lucide-react";
import { IconButton, toolbarIconProps } from "@/shared/ui";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { useSidebarCollapsedStore } from "./sidebarCollapsed";

/** Hides or shows the vertical tab sidebar. */
export function SidebarToggleButton({ side = "left" }: { side?: "left" | "right" }) {
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);
  const Icon = side === "left" ? PanelLeft : PanelRight;
  return (
    <IconButton
      label={collapsed ? "Show sidebar" : "Hide sidebar"}
      size="xs"
      className="size-7"
      tooltip={false}
      onClick={() => {
        // Native pages sit above the app, so they step aside while the drawer slides.
        setBrowserWebviewsSuspended(true, "sidebar-toggle");
        window.setTimeout(() => setBrowserWebviewsSuspended(false, "sidebar-toggle"), 340);
        useSidebarCollapsedStore.getState().toggle();
      }}
    >
      {/* Panel glyphs fill their box, so they take the sidebar's 18px optical size (see
          browserToolbar.css); without a size class the xs button shrinks them to 14px. */}
      <Icon {...toolbarIconProps} className="size-4.5" />
    </IconButton>
  );
}
