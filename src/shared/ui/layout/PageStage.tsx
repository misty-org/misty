import type { ReactNode, RefObject } from "react";
import { cn } from "../classNames";
import "./pageStage.css";

/**
 * Spread on a surface that paints behind a PageStage (a panel's host): it goes clear while the
 * page is on screen, so the page shows through a menu or dialog opened over it (pageStage.css).
 */
export const pageSurfaceProps = { "data-page-surface": "" } as const;

/** Spread on a bar over a PageStage, so it keeps its color while the surface under it is clear. */
export const pageChromeProps = { "data-page-chrome": "" } as const;

export interface PageStageProps {
  hostRef: RefObject<HTMLDivElement | null>;
  /** The native page placed over the host, if one is. */
  placed: boolean;
  /** Whether that page is on screen yet. */
  presented: boolean;
  /** The person is picking an element on the page: the frame says so. */
  picking?: boolean;
  /**
   * A rounded frame with the page's corners cut to it (browserHostBounds.ts), for a page that
   * stands on its own, like the agent browser's. Without it the page fills its pane edge to edge,
   * under the pane's toolbar.
   */
  framed?: boolean;
  /** What shows before the page does: a skeleton, an empty state or a last picture. */
  children?: ReactNode;
}

/**
 * Where one of Misty's native pages is placed: an area the page runtime measures and puts the live
 * page over. Until the page is on screen the host paints the page's color (base.css); once it is,
 * nothing here is opaque, so the page shows through a menu or dialog opened over it.
 *
 * ```tsx
 * <PageStage hostRef={host} placed={Boolean(viewId)} presented={presented} framed>
 *   <SkeletonDocument />
 * </PageStage>
 * ```
 */
export function PageStage(props: PageStageProps) {
  return (
    <div data-page-stage="" className="flex min-h-0 min-w-0 flex-1">
      <div
        data-browser-corner-clip={props.framed ? "" : undefined}
        data-picking={props.picking ? "" : undefined}
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden",
          props.framed && "rounded-xl border",
          "data-[picking]:border-2 data-[picking]:border-current",
        )}
      >
        <div
          ref={props.hostRef}
          className="relative size-full"
          data-browser-page-host=""
          data-browser-page-awaiting={props.placed && !props.presented ? "" : undefined}
          data-browser-page-presented={props.placed && props.presented ? "" : undefined}
        >
          {props.presented ? null : props.children}
        </div>
      </div>
    </div>
  );
}
