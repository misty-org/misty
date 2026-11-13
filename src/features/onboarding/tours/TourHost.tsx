import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSetupStore } from "@/features/account";
import { shownOnScreen, Tour, tourTargetShown, useSplashShowing, type TourStep } from "@/shared/ui";
import { startTourEvent, useTours } from "./tourStore";
import { tours, type TourId } from "./tours";

/** After the splash has gone, long enough for the page to lay out before its tour looks. */
const SETTLE_MS = 900;
/** A tour the person asked for looks once the menu or popover that asked has closed. */
const ASKED_SETTLE_MS = 200;
/** How often, and for how long, a tour waits for its page's controls to be drawn. */
const LOOK_EVERY_MS = 400;
const LOOK_FOR_MS = 15_000;

/**
 * The tour has something to point at: at least one of its controls is on screen. A tour that
 * opens by itself also waits for the page to finish loading, with no skeleton a person can see.
 * One the person asked for (the "i", Help) doesn't: a placeholder elsewhere in the window, or in
 * the page behind a dialog, is no reason to keep them waiting.
 */
function pageReady(steps: readonly TourStep[], asked: boolean): boolean {
  const targets = steps.flatMap((step) => (step.target ? [step.target] : []));
  const pointable = targets.length === 0 || targets.some(tourTargetShown);
  if (asked) return pointable;
  const loading = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')).some(
    shownOnScreen,
  );
  return !loading && pointable;
}

/**
 * Opens `id` once the window is ready for it: the splash gone, the page settled and its controls
 * drawn. Gives up quietly when they never are, so a tour is never shown over a blank window.
 * Returns a cancel.
 */
function openWhenReady(id: TourId, open: (id: TourId) => void, asked = false): () => void {
  let timer = 0;
  const started = Date.now();
  const look = () => {
    if (pageReady(tours[id].steps, asked)) open(id);
    else if (Date.now() - started < LOOK_FOR_MS) timer = window.setTimeout(look, LOOK_EVERY_MS);
  };
  timer = window.setTimeout(look, asked ? ASKED_SETTLE_MS : SETTLE_MS);
  return () => window.clearTimeout(timer);
}

/** The tour for the page at `pathname` and `search`, if it has one. */
export function tourForPage(pathname: string, search: string): TourId | null {
  const params = new URLSearchParams(search);
  if (pathname === "/agents") {
    const view = params.get("view");
    // Old names for the same pages.
    if (view === "office" || view === "studio") return "studio";
    if (view === "lab" || view === "tutor" || view === "notebooks")
      return params.get("item")?.startsWith("notebook:") ? "notebook" : "lab";
    if (view === "integrations") return "integrations";
    // No view, a retired one or an unknown one: the chat.
    return "welcome";
  }
  const space = /^\/spaces\/[^/]+(?:\/([^/]+)(?:\/([^/]+))?)?/.exec(pathname);
  if (space) {
    const [, section = "home", item] = space;
    switch (section) {
      case "home":
      case "settings":
        return "space";
      case "chat":
      case "social":
        return "space-chat";
      case "notes":
        return params.get("note") ? "doc" : "docs";
      case "drawings":
        return item ? "drawing" : "docs";
      case "library":
      case "files":
        return "library";
      case "planner":
        return "planner";
      case "calendar":
        return "calendar";
    }
  }
  return null;
}

/** The tour for a workspace tab's route, such as `/agents?view=lab`, if its page has one. */
export function tourForRoute(route: string): TourId | null {
  const url = new URL(route, "misty://app");
  return tourForPage(url.pathname, url.search);
}

/**
 * Shows Misty's tours in the main window. Once setup is done, the welcome tour opens by itself the
 * first time the chat is in view, and each page's own tour the first time that page opens after
 * it. "Show me around" in Help, or the "i" button (`TourInfoButton`) in the window's bottom bar
 * (for the focused pane) or a popup's corner, asks for a tour again. Each opens by itself once per device.
 */
export function TourHost() {
  const location = useLocation();
  const welcomed = useSetupStore((state) => state.welcomed);
  const { loaded, seen, active, open, close } = useTours();
  // Nothing pops up while Misty's loading splash is on screen.
  const splash = useSplashShowing();
  const page = tourForPage(location.pathname, location.search);

  useEffect(() => void useTours.getState().load(), []);

  // Only after the welcome tour does a page's own tour open by itself.
  const due =
    !splash &&
    loaded &&
    welcomed &&
    !active &&
    page !== null &&
    !seen.includes(page) &&
    (page === "welcome" || seen.includes("welcome"));
  useEffect(() => {
    if (!due || !page) return;
    return openWhenReady(page, open);
  }, [due, page, open]);

  useEffect(() => {
    const onStart = (event: Event) => {
      const asked = (event as CustomEvent<TourId | "here">).detail;
      const id = asked === "here" ? (page ?? "welcome") : asked;
      // After the Help dialog or menu that asked has closed.
      openWhenReady(id, (ready) => useTours.getState().open(ready), true);
    };
    window.addEventListener(startTourEvent, onStart);
    return () => window.removeEventListener(startTourEvent, onStart);
  }, [page]);

  const tour = active ? tours[active] : null;
  return (
    <Tour
      key={active ?? ""}
      open={Boolean(tour)}
      label={tour?.label ?? ""}
      steps={tour?.steps ?? []}
      onClose={close}
    />
  );
}
