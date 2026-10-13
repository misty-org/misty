import { routes } from "@/features/app-shell";
import { useAppThemeStore } from "@/features/settings";
import { Button } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { startCloudFlight, type CloudFlight } from "./cloudFlight";
import { hushWind, playDiveWind, playIntroWind } from "./windSound";
import "./welcome.css";

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/** The title starts to emerge while the clouds are still rushing past. */
const HERO_DELAY_MS = 1500;
/** Leave while the dive's mist covers the screen, before the hero has fully gone. */
const DIVE_MS = 1300;

type Phase = "waiting" | "flying" | "in" | "out";

/**
 * The signed-out start screen: a flight through cloud that waits for the first click, so the
 * animation and its quiet wind start together, then Sign in or Create account.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useAppThemeStore((state) => state.resolvedTheme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flightRef = useRef<CloudFlight | null>(null);
  const [reduce] = useState(reducedMotion);
  // Browsers only allow sound after a gesture; a click that already happened counts.
  const [phase, setPhase] = useState<Phase>(() =>
    reduce ? "in" : navigator.userActivation?.hasBeenActive ? "flying" : "waiting",
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const flight = startCloudFlight(canvas, {
      theme: useAppThemeStore.getState().resolvedTheme,
      reducedMotion: reduce,
    });
    flightRef.current = flight;
    return () => {
      flight.destroy();
      flightRef.current = null;
    };
  }, [reduce]);

  useEffect(() => flightRef.current?.setTheme(theme), [theme]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const begin = () => setPhase("flying");
    window.addEventListener("pointerdown", begin, { capture: true, once: true });
    window.addEventListener("keydown", begin, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", begin, { capture: true });
      window.removeEventListener("keydown", begin, { capture: true });
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "flying") return;
    flightRef.current?.begin();
    playIntroWind();
    const timer = window.setTimeout(() => setPhase("in"), HERO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Leaving keeps the dive's wind easing out over the sign-in page; anything else fades it.
  const leavingRef = useRef(false);
  useEffect(
    () => () => {
      if (!leavingRef.current) hushWind();
    },
    [],
  );

  const leave = (to: string) => {
    if (phase === "out") return;
    const go = () => navigate(to, { state: location.state });
    if (reduce) return go();
    setPhase("out");
    leavingRef.current = true;
    flightRef.current?.dive();
    playDiveWind();
    window.setTimeout(go, DIVE_MS);
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-charcoal-bg">
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
        <p
          className="misty-welcome-hint col-start-1 row-start-1 text-[13px] text-cream-muted"
          data-visible={phase === "waiting"}
          aria-hidden={phase !== "waiting"}
        >
          Click anywhere to begin
        </p>
        <div
          className="misty-welcome-hero relative col-start-1 row-start-1 flex flex-col items-center"
          data-phase={phase === "in" ? "in" : phase === "out" ? "out" : undefined}
          aria-hidden={phase !== "in"}
        >
          <h1 className="misty-welcome-title text-[clamp(2.65rem,7.5vw,7.25rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-cream-bright">
            <span className="block text-cream-muted">Welcome to</span>
            <span className="mt-2 block">Misty</span>
          </h1>
          <div className="pointer-events-auto mt-9 flex flex-wrap justify-center gap-3">
            <Button size="lg" className="px-5" onClick={() => leave(routes.signIn)}>
              Sign in
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="px-5"
              onClick={() => leave(routes.register)}
            >
              Create account
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
