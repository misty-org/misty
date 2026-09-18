import { useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { ExternalLink, MoreVertical } from "lucide-react";
import { BrowserZoomControls, useBrowserZoom } from "./BrowserZoomControls";
import { useBrowserOverlay } from "./useBrowserOverlay";
import "../../shared/websiteChrome.css";

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
  const zoom = useBrowserZoom(
    props.zoomId,
    props.setZoom ?? (async () => {}),
    props.reportError,
  );
  const overlay = useBrowserOverlay(
    props.overlayReason ?? "menu",
    props.setOverlay,
  );
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
          <MoreVertical size={16} strokeWidth={1.8} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="website-header-menu">
        <BrowserZoomControls zoom={zoom} />
        <hr />
        <button
          disabled={!(props.canOpenExternal ?? /^https?:\/\//i.test(props.url))}
          onClick={() => {
            overlay.onOpenChange(false);
            void props.openExternal(props.url).catch(props.reportError);
          }}
        >
          <ExternalLink size={15} />
          Open link
        </button>
      </PopoverContent>
    </Popover>
  );
}
