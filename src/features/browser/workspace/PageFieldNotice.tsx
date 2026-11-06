import type { ReactNode } from "react";
import type { PageFieldMenu, PageFieldMenuStore } from "@/features/webviews/pageFieldMenu";
import { cn, Portal } from "@/shared/ui";

/** Room to keep for a chip sized by its text when it sits near the page's right edge. */
const FITTED_WIDTH = 140;

function pageHost(tabId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-browser-workspace-tab="${CSS.escape(tabId)}"] [data-browser-page-host]`,
  );
}

/**
 * Misty's own surface under a field in a page. Anything in a page's document can be read and
 * clicked by its scripts, so what a page must not reach goes here. A notice rather than a menu, so
 * the page keeps the keyboard and someone can keep typing. The page only suggests where its field
 * is, so this always stays inside the page.
 */
export function PageFieldNotice<M extends PageFieldMenu>(props: {
  tabId: string;
  menu: M;
  store: PageFieldMenuStore<M>;
  label: string;
  /** At least this wide, and as wide as the field; without it, as wide as the content. */
  minWidth?: number;
  children: ReactNode;
}) {
  const host = pageHost(props.tabId);
  if (!host) return null;
  const { place, id } = props.menu;
  const { hold } = props.store.getState();
  const page = host.getBoundingClientRect();
  const width =
    props.minWidth === undefined
      ? undefined
      : Math.min(Math.max((place.width ?? 0) * page.width, props.minWidth), page.width);
  const room = Math.max(page.width - (width ?? FITTED_WIDTH), 0);
  const left = page.left + Math.min(place.left * page.width, room);
  const top = page.top + place.bottom * page.height + 4;
  return (
    <Portal>
      <div
        role="listbox"
        aria-label={props.label}
        data-private="true"
        data-misty-notification="true"
        data-misty-window-drag-block="true"
        className={cn(
          "ph-no-capture fixed layer-notification flex max-h-64 flex-col gap-0.5 overflow-y-auto",
          "rounded-lg border border-charcoal-border bg-charcoal-card p-1 text-cream",
        )}
        style={{ left, top, width }}
        onPointerEnter={() => hold(id)}
        onPointerLeave={() => hold(null)}
      >
        {props.children}
      </div>
    </Portal>
  );
}
