import type { ReactNode } from "react";

import {
  MistyAppMockup,
  type MockupView,
} from "@/components/marketing/appchrome";
import { ScreenshotSlot } from "@/components/marketing/previews";
import type { ProductScreenshotSlotId } from "@/content/productScreenshotSlots";
import { useReveal } from "@/hooks/useReveal";
import { cn } from "@/lib/utils";

type ShowcaseCard = {
  title: string;
  description: string;
  view: MockupView;
  slot: ProductScreenshotSlotId;
  className: string;
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
    className: "lg:col-span-2",
  },
  {
    title: "Browser and Files, built in",
    description:
      "Research, browse local and connected files, and keep private work beside the apps that need it.",
    view: "files",
    slot: "private-files",
    className: "",
  },
  {
    title: "Agents work beside you",
    description:
      "Add an Agent when you want help planning, researching, or executing across the workspace.",
    view: "agent",
    slot: "agent-workspace",
    className: "",
  },
  {
    title: "Share context when you want to",
    description:
      "Spaces and Libraries bring people, Agents, and selected resources into the same working context.",
    view: "library",
    slot: "space-library",
    className: "lg:col-span-2",
  },
];

function ShowcaseCard({
  card,
  children,
}: {
  card: ShowcaseCard;
  children: ReactNode;
}) {
  return (
    <article
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)] p-5 sm:p-6",
        card.className,
      )}
    >
      <h3 className="text-lg font-medium tracking-[-0.025em] text-[var(--marketing-foreground)] sm:text-xl">
        {card.title}
      </h3>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--marketing-muted)]">
        {card.description}
      </p>
      {/* The window fills whatever height the row leaves it, so a row of
          cards lines up even when their copy runs to different lengths. */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col">{children}</div>
    </article>
  );
}

export function FeatureShowcase() {
  const ref = useReveal<HTMLElement>();

  return (
    <section
      id="features"
      ref={ref}
      aria-label="Misty product showcase"
      className="reveal relative z-10 scroll-mt-24 bg-background py-3 sm:py-4"
    >
      <div className="site-container">
        <div className="grid gap-3 lg:grid-cols-3 lg:grid-rows-[30rem_28rem]">
          {cards.map((card) => (
            <ShowcaseCard key={card.title} card={card}>
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
      </div>
    </section>
  );
}
