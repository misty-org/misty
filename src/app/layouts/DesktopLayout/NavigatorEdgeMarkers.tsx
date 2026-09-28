import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import { appZoomChangedEvent } from "@/shared/hooks/useAppZoom";

type Marker = { id: number; center: number; state: "active" | "hover" | "hidden" };

/** Keep the rail's grow/fade animation at the window edge, outside scroll clipping. */
export function NavigatorEdgeMarkers({
  navigatorRef,
  position,
}: {
  navigatorRef: RefObject<HTMLElement | null>;
  position: DockPosition;
}) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const vertical = isSideDock(position);

  useEffect(() => {
    const nav = navigatorRef.current;
    if (!nav) return;
    const ids = new WeakMap<HTMLElement, number>();
    let nextId = 0;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = Array.from(
        nav.querySelectorAll<HTMLElement>("[data-navigation-destination], [data-spaces-toggle]"),
      ).map((element): Marker => {
        if (!ids.has(element)) ids.set(element, nextId++);
        const rect = element.getBoundingClientRect();
        const center = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        let visible = rect.width > 0 && rect.height > 0 && !element.closest("[inert]");
        // A portalled marker must disappear when its source scrolls out of view.
        for (let parent = element.parentElement; visible && parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden|clip)/.test(vertical ? style.overflowY : style.overflowX)) {
            const bounds = parent.getBoundingClientRect();
            visible = vertical
              ? center >= bounds.top && center <= bounds.bottom
              : center >= bounds.left && center <= bounds.right;
          }
          if (parent === nav) break;
        }
        const active = element.hasAttribute("data-spaces-toggle")
          ? element.dataset.active === "true" && element.getAttribute("aria-expanded") === "false"
          : element.matches('[aria-current="page"], [aria-pressed="true"]');
        return {
          id: ids.get(element)!,
          center,
          state: !visible
            ? "hidden"
            : active
              ? "active"
              : element.hasAttribute("data-navigation-destination") &&
                  element.matches(":hover, :focus-visible")
                ? "hover"
                : "hidden",
        };
      });
      setMarkers((previous) =>
        previous.length === next.length &&
        previous.every(
          (marker, i) =>
            marker.id === next[i].id &&
            marker.center === next[i].center &&
            marker.state === next[i].state,
        )
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // Observe the stack too: its animated height moves subsequent destinations.
    const resize = new ResizeObserver(schedule);
    const observeSizes = () => {
      resize.disconnect();
      resize.observe(nav);
      nav
        .querySelectorAll("a, button, [data-spaces-stack], .misty-navigator-items")
        .forEach((element) => resize.observe(element));
    };
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) observeSizes();
      schedule();
    });
    mutations.observe(nav, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-current",
        "aria-pressed",
        "aria-expanded",
        "data-state",
        "data-active",
        "inert",
      ],
    });
    // Visibility is owned by the rail wrapper; a hidden rail must not leave markers behind.
    if (nav.parentElement)
      mutations.observe(nav.parentElement, { attributes: true, attributeFilter: ["inert"] });
    observeSizes();
    const events = ["pointerover", "pointerout", "focusin", "focusout"] as const;
    events.forEach((event) => nav.addEventListener(event, schedule));
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener(appZoomChangedEvent, schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      events.forEach((event) => nav.removeEventListener(event, schedule));
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener(appZoomChangedEvent, schedule);
    };
  }, [navigatorRef, vertical]);

  return createPortal(
    <div aria-hidden="true" data-navigator-edge-markers="true">
      {markers.map((marker) => (
        <span
          key={marker.id}
          className="misty-navigator-edge-marker"
          data-edge={position}
          data-state={marker.state}
          style={vertical ? { top: marker.center } : { left: marker.center }}
        />
      ))}
    </div>,
    document.body,
  );
}
