import type { ReactNode } from "react";

import { MistyAppMockup, type MockupView } from "@/components/marketing/appchrome";
import { useReveal } from "@/hooks/useReveal";
import { cn } from "@/lib/utils";

type ShowcaseCard = {
  index: string;
  title: string;
  description: string;
  view: MockupView;
  className: string;
};

/*
 * Every card shows the surface it is describing. The showcase used to render
 * five dashed "Screenshot placeholder" boxes; each one is now the real
 * window, drawn in DOM, so the grid argues for the product instead of
 * promising that a picture of it will arrive later.
 */
const cards: ShowcaseCard[] = [
  {
    index: "01",
    title: "One Space per group",
    description:
      "People, conversations, tasks, a shared Library, and Agents — all in the same place, all seeing the same state of the work.",
    view: "space",
    className: "lg:col-span-2",
  },
  {
    index: "02",
    title: "Your files stay yours",
    description:
      "Browse local and connected files privately. Nothing reaches the Space until you put it there.",
    view: "files",
    className: "",
  },
  {
    index: "03",
    title: "Agents that read the Space",
    description:
      "Custom Agents work from permitted context only, with model routing handled for you.",
    view: "agent",
    className: "",
  },
  {
    index: "04",
    title: "A Library the group builds",
    description:
      "Collect the files, links, and notes the work depends on, without exposing everything on your device.",
    view: "library",
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
      <p className="text-[11px] font-medium tracking-[0.08em] text-[var(--marketing-muted)]">
        {card.index}
      </p>
      <h3 className="mt-3 text-lg font-medium tracking-[-0.025em] text-[var(--marketing-foreground)] sm:text-xl">
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
      ref={ref}
      aria-label="Misty product showcase"
      className="reveal py-3 sm:py-4"
    >
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-3 lg:grid-cols-3 lg:grid-rows-[30rem_28rem]">
          {cards.map((card) => (
            <ShowcaseCard key={card.title} card={card}>
              <MistyAppMockup view={card.view} fill shadow={false} />
            </ShowcaseCard>
          ))}
        </div>
      </div>
    </section>
  );
}
