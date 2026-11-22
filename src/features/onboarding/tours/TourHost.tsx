import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSetupStore } from "@/features/account";
import { shownOnScreen, Tour, tourTargetShown, useSplashShowing, type TourStep } from "@misty/ui";
import { startTourEvent, useTours } from "./tourStore";
import { tours, type TourId } from "./tours";

const SETTLE_MS = 900;
const ASKED_SETTLE_MS = 200;
const LOOK_EVERY_MS = 400;
const LOOK_FOR_MS = 15_000;

function pageReady(steps: readonly TourStep[], asked: boolean): boolean {
  const targets = steps.flatMap((step) => (step.target ? [step.target] : []));
  const pointable = targets.length === 0 || targets.some(tourTargetShown);
  if (asked) return pointable;
  const loading = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')).some(
    shownOnScreen,
  );
  return !loading && pointable;
}

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

export function tourForPage(pathname: string, _search: string): TourId | null {
  if (pathname === "/agents") {
    return "welcome";
  }
  const space = /^\/spaces\/[^/]+(?:\/([^/]+)(?:\/([^/]+))?)?/.exec(pathname);
  if (space) {
    const [, section = "home"] = space;
    switch (section) {
      case "home":
      case "settings":
        return "space";
      case "chat":
      case "social":
        return "space-chat";
    }
  }
  return null;
}

export function tourForRoute(route: string): TourId | null {
  const url = new URL(route, "misty://app");
  return tourForPage(url.pathname, url.search);
}

export function TourHost() {
  const location = useLocation();
  const welcomed = useSetupStore((state) => state.welcomed);
  const { loaded, seen, active, open, close } = useTours();
  const splash = useSplashShowing();
  const page = tourForPage(location.pathname, location.search);

  useEffect(() => void useTours.getState().load(), []);

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
