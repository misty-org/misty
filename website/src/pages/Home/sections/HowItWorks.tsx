import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  MistyAppMockup,
  type MockupView,
} from "@/components/marketing/appchrome";
import { ScreenshotSlot, VideoSlot } from "@/components/marketing/previews";
import type { ProductScreenshotSlotId } from "@/content/productScreenshotSlots";
import type { ProductVideoSlotId } from "@/content/productVideoSlots";
import { beatPosition, useScrollProgress } from "@/hooks/useScrollProgress";
import { cn } from "@/lib/utils";

type Beat = {
  title: string;
  description: string;
  view: MockupView;
  fallbackSlot: ProductScreenshotSlotId;
  videoSlot: ProductVideoSlotId;
};

const beats: Beat[] = [
  {
    title: "Choose your favorite apps",
    description:
      "Add Notes, Planner, Browser, Files, Code, and more from one menu. Keep the apps you use close and leave the rest out of the way.",
    view: "space",
    fallbackSlot: "space-overview",
    videoSlot: "choose-apps",
  },
  {
    title: "Build layouts for flexible workspaces",
    description:
      "Arrange apps into tabs, windows, and panels that fit the task. Move between focused and multi-app layouts without losing your place.",
    view: "space",
    fallbackSlot: "space-overview",
    videoSlot: "workspace-layouts",
  },
  {
    title: "Talk to Agents to manage automations and workflows",
    description:
      "Tell Misty what you want to happen in plain language. Agents can help coordinate automations, manage recurring work, and keep workflows moving.",
    view: "agent",
    fallbackSlot: "agent-workspace",
    videoSlot: "agent-workflows",
  },
  {
    title: "Share your Space with others",
    description:
      "Invite people into a Space with the apps, files, conversations, and context already in place. Everyone can start contributing without rebuilding the setup.",
    view: "library",
    fallbackSlot: "space-library",
    videoSlot: "share-space",
  },
];

/* Beats stack in a single grid cell so the container sizes to the tallest one
   and nothing gets clipped when copy lengths differ. */
const STACKED = "[grid-area:1/1]";
const SCROLL_SMOOTHING_MS = 80;
const FADE_START = 0.8;
const FADE_END = 1;

function smoothstep(start: number, end: number, value: number) {
  const progress = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

function useSmoothedProgress(target: number) {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    const start = valueRef.current;
    const distance = target - start;

    if (Math.abs(distance) < 0.0001) {
      valueRef.current = target;
      setValue(target);
      return;
    }

    const startedAt = performance.now();
    let frame = 0;

    const update = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / SCROLL_SMOOTHING_MS);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const next = start + distance * eased;

      valueRef.current = next;
      setValue(next);

      if (elapsed < 1) frame = window.requestAnimationFrame(update);
    };

    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

function beatMotion(
  index: number,
  outgoing: number,
  incoming: number,
  transition: number,
  media = false,
): CSSProperties {
  const isOutgoing = index === outgoing;
  const isIncoming = index === incoming;
  const isSettled = outgoing === incoming;
  const opacity = isSettled
    ? isIncoming
      ? 1
      : 0
    : isOutgoing
      ? 1 - transition
      : isIncoming
        ? transition
        : 0;
  const scale = media ? 0.992 + opacity * 0.008 : 1;

  return {
    opacity,
    filter: `blur(${(1 - opacity) * 1.5}px)`,
    pointerEvents: opacity < 0.5 ? "none" : undefined,
    transform: `translate3d(0, 0, 0) scale(${scale})`,
  };
}

function BeatCopy({
  beat,
  centered = false,
}: {
  beat: Beat;
  centered?: boolean;
}) {
  return (
    <>
      <h3 className="text-[clamp(1.5rem,2.6vw,2.25rem)] font-medium leading-[1.15] tracking-[-0.03em] text-[var(--marketing-foreground)]">
        {beat.title}
      </h3>
      <p
        className={cn(
          "mt-5 max-w-md text-base leading-relaxed text-[var(--marketing-muted)]",
          centered && "mx-auto",
        )}
      >
        {beat.description}
      </p>
    </>
  );
}

function BeatMedia({ beat, active }: { beat: Beat; active?: boolean }) {
  return (
    <VideoSlot slot={beat.videoSlot} active={active} fill>
      <ScreenshotSlot
        slot={beat.fallbackSlot}
        fill
        imageClassName="object-contain object-center"
      >
        <MistyAppMockup
          view={beat.view}
          fill
          shadow={false}
          className="ring-1 ring-white/[0.07]"
        />
      </ScreenshotSlot>
    </VideoSlot>
  );
}

/**
 * A scroll-pinned walk through the product.
 *
 * The window pins to the viewport while roughly one screen of scroll is spent
 * on each beat, so scrolling drives a demo rather than paging past cards.
 *
 * The pinned track is desktop-only, and `prefers-reduced-motion` swaps it for
 * the stacked list (see `.pin-track` / `.pin-stacked` in index.css). Every
 * beat is therefore reachable without animating anything — no content lives
 * only inside the animation.
 */
export function HowItWorks() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const smoothedProgress = useSmoothedProgress(progress);
  const { index: active, within } = beatPosition(
    smoothedProgress,
    beats.length,
  );
  const incoming = Math.min(beats.length - 1, active + 1);
  const transition =
    active === beats.length - 1
      ? 0
      : smoothstep(FADE_START, FADE_END, within);
  const visibleBeat = transition >= 0.5 ? incoming : active;

  // Hand the indicator to the incoming beat as soon as its crossfade starts.
  // The first beat uses the shorter pre-transition interval; every following
  // beat then owns one full segment, so the fill remains continuous across
  // the underlying `within` reset at each beat boundary.
  const narrativePosition = active + within;
  const indicatorPosition =
    narrativePosition <= FADE_START
      ? narrativePosition / FADE_START
      : 1 + narrativePosition - FADE_START;
  const indicatorActive = Math.min(
    beats.length - 1,
    Math.floor(indicatorPosition),
  );
  const indicatorWithin = Math.min(
    1,
    Math.max(0, indicatorPosition - indicatorActive),
  );

  // The bar follows the same damped progress and transition boundary as the
  // content, rather than letting one bar visually own two different beats.
  const fill = (index: number) =>
    index < indicatorActive
      ? 1
      : index === indicatorActive
        ? indicatorWithin
        : 0;

  return (
    <section
      aria-label="How Misty works"
      className="marketing-dark my-3 overflow-x-clip sm:my-4 lg:-mt-[14svh] lg:-mb-[8svh]"
    >
      {/* Track height sets the pace: one viewport of scroll per beat, plus one
          more to hold the last beat before the section releases. */}
      <div
        ref={ref}
        className="pin-track relative hidden lg:block"
        style={{ height: `${(beats.length + 1) * 100}svh` }}
      >
        <div className="pin-stage">
          <div className="site-container grid grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] items-center gap-x-10 xl:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)] xl:gap-x-12">
            <div className="col-start-1 row-start-1 flex h-full items-center justify-center">
              <div className="grid w-full max-w-lg text-center">
                {beats.map((beat, index) => (
                  <div
                    key={beat.title}
                    aria-hidden={index !== visibleBeat}
                    className={cn("pin-beat", STACKED)}
                    style={beatMotion(
                      index,
                      active,
                      incoming,
                      transition,
                    )}
                  >
                    <BeatCopy beat={beat} centered />
                  </div>
                ))}
              </div>
            </div>

            <div className="relative col-start-2 row-start-1 w-full place-self-center">
              <div className="grid aspect-[8/5] min-h-0 overflow-hidden rounded-xl">
                {beats.map((beat, index) => (
                  <div
                    key={beat.title}
                    aria-hidden={index !== visibleBeat}
                    className={cn("pin-beat h-full min-h-0", STACKED)}
                    style={beatMotion(
                      index,
                      active,
                      incoming,
                      transition,
                      true,
                    )}
                  >
                    <BeatMedia beat={beat} active={index === visibleBeat} />
                  </div>
                ))}
              </div>

              {/* Keep the indicator visually attached without letting it
                  shift the media frame away from the viewport center. */}
              <div className="absolute inset-x-0 top-full mt-8 flex gap-2.5">
                {beats.map((beat, index) => (
                  <span
                    key={beat.title}
                    className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--marketing-border-strong)]"
                  >
                    <span
                      className="block h-full rounded-full bg-[var(--marketing-foreground)]"
                      style={{ width: `${fill(index) * 100}%` }}
                    />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Small screens — and reduced motion at any width — get the same beats
          as an ordinary stacked list. */}
      <div className="site-container pin-stacked space-y-14 py-16 lg:hidden">
        {beats.map((beat) => (
          <div key={beat.title}>
            <BeatCopy beat={beat} />
            <div className="mt-7 aspect-[8/5] overflow-hidden rounded-xl">
              <BeatMedia beat={beat} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
