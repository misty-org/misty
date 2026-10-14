import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { browserToolbarStyles, useBrowserChromeSlot } from "@/features/browser/workspace";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { Pressable, cn, IconButton, toolbarIconProps } from "@/shared/ui";

/**
 * The browser toolbar on a page that isn't a browser page: resting back, forward and reload,
 * an empty address field that opens search, and the app's Spaces and profile buttons. With
 * horizontal tabs the toolbar is always there, so the rest of the app stays one click away.
 */
export function PaneToolbarFallback() {
  const chrome = useBrowserChromeSlot();
  return (
    <div
      className={cn(browserToolbarStyles.bar, "border-cream/[0.055]")}
      style={{ backgroundColor: "var(--workspace-tab-surface)" }}
      data-window-toolbar
      data-browser-toolbar
      data-misty-window-drag-block="true"
    >
      <div className={browserToolbarStyles.group}>
        <IconButton label="Back" tooltip={false} disabled>
          <ArrowLeft {...toolbarIconProps} />
        </IconButton>
        <IconButton label="Forward" tooltip={false} disabled>
          <ArrowRight {...toolbarIconProps} />
        </IconButton>
        <IconButton label="Reload" tooltip={false} disabled>
          <RotateCw {...browserToolbarStyles.roundIcon} />
        </IconButton>
      </div>
      <Pressable
        type="button"
        className={[
          "h-9 min-w-0 flex-1 truncate rounded-lg border border-cream/[0.07] px-3 text-left",
          "text-[13px] text-cream-muted transition-colors hover:bg-cream/[0.025]",
        ].join(" ")}
        onClick={() => useBrowserSearchStore.getState().show()}
      >
        Search or enter address
      </Pressable>
      <div className={browserToolbarStyles.group}>
        {chrome?.spaces}
        {chrome?.profile}
      </div>
    </div>
  );
}
