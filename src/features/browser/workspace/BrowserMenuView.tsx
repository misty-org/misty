import { browserToolbarStyles } from "./browserToolbarStyles";
import { useEffect } from "react";
import {
  cn,
  menuItemClass,
  menuListClass,
  menuSeparatorClass,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui";
import { ExternalLink, MoreVertical } from "lucide-react";
import { BrowserZoomControls, useBrowserZoom } from "./BrowserZoomControls";
import { useBrowserOverlay } from "./useBrowserOverlay";
import "../../../shared/toolAssets/websiteChrome.css";

export interface BrowserMenuViewProps {
  iconButtonClass: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
  zoomId?: string;
  setZoom?: (factor: number) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  reportError: (error: unknown) => void;
  url: string;
  active?: boolean;
  canOpenExternal?: boolean;
  label?: string;
  overlayReason?: string;
}

/** The same compact menu for Browser and every embedded website. */
export function BrowserMenuView(props: BrowserMenuViewProps) {
  const zoom = useBrowserZoom(props.zoomId, props.setZoom ?? (async () => {}), props.reportError);
  const overlay = useBrowserOverlay(props.overlayReason ?? "menu", props.setOverlay);
  useEffect(() => {
    if (props.active === false) overlay.onOpenChange(false);
  }, [props.active, overlay.onOpenChange]);
  return (
    <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={props.iconButtonClass}
          aria-label={props.label ?? "Browser menu"}
          title="More"
        >
          <MoreVertical {...browserToolbarStyles.icon} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn(
          "website-header-menu max-h-[calc(100dvh-80px)] w-60 overflow-y-auto",
          menuListClass,
        )}
      >
        <BrowserZoomControls zoom={zoom} />
        <div role="separator" className={menuSeparatorClass} />
        <button
          type="button"
          className={menuItemClass}
          disabled={!(props.canOpenExternal ?? /^https?:\/\//i.test(props.url))}
          onClick={() => {
            overlay.onOpenChange(false);
            void props.openExternal(props.url).catch(props.reportError);
          }}
        >
          <ExternalLink />
          Open link
        </button>
      </PopoverContent>
    </Popover>
  );
}
