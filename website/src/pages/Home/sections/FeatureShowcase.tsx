import type { ReactNode } from "react";

import { publicPageContainer } from "@/components/marketing";
import {
  AgentBuilderPreview,
  AgentsPreview,
  ChatPreview,
  FilesPreview,
  SharedLibraryPreview,
  TasksPreview,
} from "@/components/marketing/previews";
import type { MarketingCopy } from "@/content/marketingCopy";
import { cn } from "@/lib/utils";

type Feature = MarketingCopy["home"]["features"][number];

/**
 * One feature row: sticky copy on one side, stacked previews on the other.
 * Every other row flips so the page alternates down the screen.
 */
function FeatureRow({
  feature,
  reversed = false,
  children,
}: {
  feature: Feature;
  reversed?: boolean;
  children: ReactNode;
}) {
  return (
    <article className="border-b border-border py-16 sm:py-24">
      <div
        className={cn(
          publicPageContainer,
          "grid gap-12 lg:items-start lg:gap-16",
          reversed
            ? "lg:grid-cols-[1.28fr_0.72fr]"
            : "lg:grid-cols-[0.72fr_1.28fr]",
        )}
      >
        <div
          className={cn(
            "max-w-md lg:sticky lg:top-28",
            reversed && "lg:order-last",
          )}
        >
          <p className="text-sm text-muted-foreground">{feature.label}</p>
          <h2 className="mt-4 text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
            {feature.title}
          </h2>
          <p className="mt-5 text-base leading-7 text-muted-foreground">
            {feature.description}
          </p>
        </div>
        <div className={cn("grid gap-5", reversed && "lg:order-first")}>
          {children}
        </div>
      </div>
    </article>
  );
}

export function FeatureShowcase({
  features,
}: {
  features: MarketingCopy["home"]["features"];
}) {
  return (
    <section aria-label="Misty features">
      <FeatureRow feature={features[0]}>
        <AgentsPreview />
        <AgentBuilderPreview />
      </FeatureRow>

      <FeatureRow feature={features[1]} reversed>
        <ChatPreview />
        <TasksPreview />
      </FeatureRow>

      <FeatureRow feature={features[2]}>
        <FilesPreview />
        <SharedLibraryPreview />
      </FeatureRow>
    </section>
  );
}
