import { cn, Portal } from "@/shared/ui";
import type { ReactNode, RefObject } from "react";
import { useBrowserToolbarSlot } from "./browserToolbarSlot";
import { browserToolbarStyles } from "./browserToolbarStyles";

/**
 * The focused browser pane's toolbar, drawn into the tab sidebar's slots: back, forward and
 * reload beside the sidebar toggle, the pinned extensions in the tools row above the address
 * field, and the address field (with the ⋯ menu) in its top slot.
 */
export function BrowserSidebarChrome(props: {
  nav: ReactNode;
  /** The private and Misty marks, when the tab has any. */
  badges: ReactNode;
  address: ReactNode;
  addressRef: RefObject<HTMLDivElement | null>;
  extensions: ReactNode;
}) {
  const { nav: navSlot, top: topSlot, tools: toolsSlot } = useBrowserToolbarSlot();
  return (
    <>
      {navSlot ? (
        <Portal container={navSlot}>
          <div
            className={cn(browserToolbarStyles.group)}
            data-browser-toolbar
            data-sidebar
            data-misty-window-drag-block="true"
          >
            {props.nav}
          </div>
        </Portal>
      ) : null}
      {toolsSlot ? (
        <Portal container={toolsSlot}>
          <div className={cn(browserToolbarStyles.group)} data-browser-toolbar data-sidebar>
            {props.extensions}
          </div>
        </Portal>
      ) : null}
      {topSlot ? (
        <Portal container={topSlot}>
          <div className={browserToolbarStyles.sidebarTop} data-browser-toolbar data-sidebar>
            {props.badges ? (
              <div className="flex items-center gap-1" data-misty-window-drag-block="true">
                {props.badges}
              </div>
            ) : null}
            <div
              ref={props.addressRef}
              className="flex items-center gap-0.5"
              data-misty-window-drag-block="true"
            >
              {props.address}
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
}
