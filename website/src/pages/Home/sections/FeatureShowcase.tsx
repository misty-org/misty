import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import {
  MistyAppMockup,
  type MockupView,
} from "@/components/marketing/appchrome";
import { ScreenshotSlot } from "@/components/marketing/previews";
import { Button } from "@/components/ui/button";
import type { ProductScreenshotSlotId } from "@/content/productScreenshotSlots";
import { useReveal } from "@/hooks/useReveal";

type ShowcaseCard = {
  title: string;
  description: string;
  view: MockupView;
  slot: ProductScreenshotSlotId;
};

/*
 * Every card resolves through the shared screenshot inventory. Missing
 * captures stay as responsive DOM previews until the matching file is added.
 */
const cards: ShowcaseCard[] = [
  {
    title: "Start with the apps you need",
    description:
      "Keep Misty focused with Notes or Planner, or open a complete set of apps around the work.",
    view: "space",
    slot: "space-overview",
  },
  {
    title: "Browser and Files, built in",
    description:
      "Research, browse local and connected files, and keep private work beside the apps that need it.",
    view: "files",
    slot: "private-files",
  },
  {
    title: "Agents work beside you",
    description:
      "Add an Agent when you want help planning, researching, or executing across the workspace.",
    view: "agent",
    slot: "agent-workspace",
  },
  {
    title: "Share context when you want to",
    description:
      "Spaces and Libraries bring people, Agents, and selected resources into the same working context.",
    view: "library",
    slot: "space-library",
  },
];

function ShowcaseCard({
  card,
  index,
  active,
  children,
}: {
  card: ShowcaseCard;
  index: number;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <article
      data-gallery-card={index}
      data-active={active}
      aria-current={active ? "true" : undefined}
      className="feature-gallery-card flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)]"
    >
      <div className="px-6 pt-6 sm:px-8 sm:pt-8">
        <h3 className="max-w-2xl text-2xl font-medium tracking-[-0.025em] text-[var(--marketing-foreground)] sm:text-3xl">
          {card.title}
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--marketing-muted)] sm:text-base">
          {card.description}
        </p>
      </div>
      <div className="mt-7 flex min-h-0 flex-1 flex-col px-4 pb-4 sm:mt-8 sm:px-6 sm:pb-6">
        {children}
      </div>
    </article>
  );
}

export function FeatureShowcase() {
  const ref = useReveal<HTMLElement>();
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current);
      }
    },
    [],
  );

  const goToCard = (requestedIndex: number) => {
    const track = trackRef.current;
    const nextIndex = Math.min(Math.max(requestedIndex, 0), cards.length - 1);
    const card = track?.querySelector<HTMLElement>(
      `[data-gallery-card="${nextIndex}"]`,
    );

    if (!track || !card) return;

    const padding = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    track.scrollTo({
      left: card.offsetLeft - padding,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    setCurrentIndex(nextIndex);
  };

  const updateCurrentCard = () => {
    const track = trackRef.current;
    if (!track) return;

    if (scrollFrame.current !== null) {
      cancelAnimationFrame(scrollFrame.current);
    }

    scrollFrame.current = requestAnimationFrame(() => {
      const padding = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
      const cardsInTrack = Array.from(
        track.querySelectorAll<HTMLElement>("[data-gallery-card]"),
      );
      const nextIndex = cardsInTrack.reduce((closestIndex, card, index) => {
        const distance = Math.abs(card.offsetLeft - padding - track.scrollLeft);
        const closestCard = cardsInTrack[closestIndex];
        const closestDistance = Math.abs(
          closestCard.offsetLeft - padding - track.scrollLeft,
        );
        return distance < closestDistance ? index : closestIndex;
      }, 0);

      setCurrentIndex(nextIndex);
      scrollFrame.current = null;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToCard(currentIndex - 1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      goToCard(currentIndex + 1);
    }
  };

  return (
    <section
      id="features"
      ref={ref}
      aria-labelledby="feature-gallery-title"
      className="reveal relative z-10 scroll-mt-24 bg-background py-20 sm:py-28"
    >
      <div className="site-container flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="feature-gallery-title"
            className="max-w-2xl text-balance text-3xl font-medium tracking-[-0.03em] text-[var(--marketing-foreground)] sm:text-5xl"
          >
            A closer look at Misty.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--marketing-muted)] sm:text-lg">
            Move through the workspace, private tools, Agents, and shared
            context.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span
            aria-live="polite"
            className="mr-1 min-w-12 text-center text-sm tabular-nums text-[var(--marketing-muted)]"
          >
            {currentIndex + 1} / {cards.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            onClick={() => goToCard(currentIndex - 1)}
            disabled={currentIndex === 0}
            aria-label="Previous feature"
            className="rounded-full border-[var(--marketing-border-strong)] bg-transparent"
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            onClick={() => goToCard(currentIndex + 1)}
            disabled={currentIndex === cards.length - 1}
            aria-label="Next feature"
            className="rounded-full border-[var(--marketing-border-strong)] bg-transparent"
          >
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        ref={trackRef}
        role="region"
        aria-label="Misty feature gallery"
        tabIndex={0}
        onScroll={updateCurrentCard}
        onKeyDown={handleKeyDown}
        className="feature-gallery-track mt-9 sm:mt-12"
      >
        {cards.map((card, index) => (
          <ShowcaseCard
            key={card.title}
            card={card}
            index={index}
            active={index === currentIndex}
          >
            <ScreenshotSlot
              slot={card.slot}
              fill
              imageClassName={
                card.slot === "space-library" ? "object-top" : undefined
              }
            >
              <MistyAppMockup view={card.view} fill shadow={false} />
            </ScreenshotSlot>
          </ShowcaseCard>
        ))}
      </div>
    </section>
  );
}
