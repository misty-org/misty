import type { ReactNode } from "react";

import { useReveal } from "@/hooks/useReveal";

type ShowcaseCardProps = {
  title: string;
  className?: string;
  children?: ReactNode;
};

function ScreenshotPlaceholder({ title }: { title: string }) {
  return (
    <div
      aria-label={`${title} screenshot placeholder`}
      className="flex h-full min-h-64 items-center justify-center p-5"
    >
      <div className="w-full max-w-sm rounded-lg border border-dashed border-[var(--marketing-border-strong)] px-5 py-4 text-center text-sm text-[var(--marketing-muted)]">
        Screenshot placeholder
      </div>
    </div>
  );
}

function ShowcaseCard({ title, className = "", children }: ShowcaseCardProps) {
  return (
    <article
      className={`relative min-h-0 overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)] ${className}`}
    >
      <div className="h-full min-h-0">{children ?? <ScreenshotPlaceholder title={title} />}</div>
      <h2 className="absolute inset-x-0 bottom-0 px-5 pb-5 text-[clamp(0.875rem,1.3vw,1.25rem)] font-medium leading-none tracking-[-0.025em] text-[var(--marketing-foreground)] lg:whitespace-nowrap sm:px-6 sm:pb-6">
        {title}
      </h2>
    </article>
  );
}

export function FeatureShowcase() {
  const ref = useReveal<HTMLElement>();

  return (
    <section ref={ref} aria-label="Misty product showcase" className="reveal py-3 sm:py-4">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-3 lg:grid-cols-3 lg:grid-rows-[minmax(26rem,1fr)_minmax(20rem,0.7fr)]">
          <ShowcaseCard
            title="Agent-native platform"
            className="lg:col-span-2"
          />
          <ShowcaseCard title="Self-updating knowledge" />
          <ShowcaseCard title="Control who has access" />
          <ShowcaseCard title="Connect with your systems" />
          <ShowcaseCard title="Collaborate with your team & agents" />
        </div>
      </div>
    </section>
  );
}
