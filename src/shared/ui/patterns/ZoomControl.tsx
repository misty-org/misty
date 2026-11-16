import type * as React from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "../controls/IconButton";
import { DropdownMenu, DropdownMenuContent } from "../overlays/DropdownMenu";
import { MenuTrigger } from "../overlays/MenuTrigger";

/**
 * Zoom out, the zoom level, zoom in: one tight group in a bar, as Preview's. The level opens a
 * menu of set levels (`children`, MenuItems). The three sit close together so they read as one
 * control, apart from the bar's other buttons.
 *
 * ```tsx
 * <ZoomControl value="Fit" onZoomIn={zoomIn} onZoomOut={zoomOut}>
 *   <MenuItem label="100%" onSelect={() => zoomTo(1)} />
 * </ZoomControl>
 * ```
 */
export function ZoomControl(props: {
  /** The level shown, such as "Fit" or "150%". */
  value: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  /** Shown in the tooltips while shortcut hints are on. */
  shortcuts?: { zoomIn?: string; zoomOut?: string };
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label="Zoom" className="flex shrink-0 items-center">
      <IconButton
        label="Zoom out"
        shortcut={props.shortcuts?.zoomOut}
        disabled={props.canZoomOut === false}
        onClick={props.onZoomOut}
      >
        <ZoomOut />
      </IconButton>
      <DropdownMenu>
        {/* Wide enough for "100%" so the arrows don't shift as the level changes. */}
        <MenuTrigger
          label="Zoom"
          value={props.value}
          chevron={false}
          fit
          justify="center"
          className="min-w-12 px-1.5 tabular-nums"
        />
        <DropdownMenuContent align="center" width="sm">
          {props.children}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        label="Zoom in"
        shortcut={props.shortcuts?.zoomIn}
        disabled={props.canZoomIn === false}
        onClick={props.onZoomIn}
      >
        <ZoomIn />
      </IconButton>
    </div>
  );
}
