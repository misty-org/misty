import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSetupStore } from "@/features/account";
import { Tour, tourTargetShown, useSplashShowing, type TourStep } from "@/shared/ui";
import { startTourEvent, useTours } from "./tourStore";
import { tours, type TourId } from "./tours";

/** After the splash has gone, long enough for the page to lay out before its tour looks. */
const SETTLE_MS = 900;
/** How often, and for how long, a tour waits for its page's controls to be drawn. */
const LOOK_EVERY_MS = 400;
const LOOK_FOR_MS = 15_000;

/** The page has drawn what the tour points at: no skeleton is left standing in for content,
 * and at least one of its controls is on screen. */
function pageReady(steps: readonly TourStep[]): boolean {
  if (document.querySelector('[data-slot="skeleton"]')) return false;
  const targets = steps.flatMap((step) => (step.target ? [step.target] : []));
  return targets.length === 0 || targets.some(tourTargetShown);
}

/**
 * Opens `id` once the window is ready for it: the splash gone, the page settled and its controls
 * drawn. Gives up quietly when they never are, so a tour is never shown over a blank window.
 * Returns a cancel.
 */
function openWhenReady(id: TourId, open: (id: TourId) => void): () => void {
  let timer = 0;
  const started = Date.now();
  const look = () => {
    if (pageReady(tours[id].steps)) open(id);
    else if (Date.now() - started < LOOK_FOR_MS) timer = window.setTimeout(look, LOOK_EVERY_MS);
  };
  timer = window.setTimeout(look, SETTLE_MS);
  return () => window.clearTimeout(timer);
}

/** The tour for the page at `pathname` and `search`, if it has one. */
export function tourForPage(pathname: string, search: string): TourId | null {
  if (pathname === "/agents") {
    const view = new URLSearchParams(search).get("view");
    if (!view) return "welcome";
    if (view === "lab" || view === "studio" || view === "integrations") return view;
    return null;
  }
  // A Space's home, not one of its pages.
  if (/^\/spaces\/[^/]+\/?$/.test(pathname)) return "space";
  return null;
}

/**
 * Shows Misty's tours in the main window. Once setup is done, the welcome tour opens by itself the
 * first time the chat is in view, and each page's own tour the first time that page opens after
 * it. "Show me around" in Help asks for the tour of the page in view. Each opens by itself once
 * per device.
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
      openWhenReady(id, (ready) => useTours.getState().open(ready));
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
