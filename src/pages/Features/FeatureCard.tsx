import {
  AgentsPreview,
  ChatPreview,
  ConnectionsPreview,
  FilesPreview,
  ProductScreenshot,
  TasksPreview,
} from "@/components/ProductPreview";
import { marketingCopy } from "@/content/marketingCopy";
import { cn } from "@/lib/utils";
import type { MainFeature } from "./featureData";

function FeaturePreview({ feature }: { feature: MainFeature }) {
  switch (feature.id) {
    case "spaces":
      return <ChatPreview />;
    case "work-together":
      return <TasksPreview />;
    case "shared-library":
      return (
        <ProductScreenshot
          src="/space-library-crop.webp"
          alt="Misty Space Library showing shared research and files"
          label="Space Library · Beta"
        />
      );
    case "integrations":
      return <ConnectionsPreview />;
    case "agents":
      return <AgentsPreview />;
    case "private-files":
      return <FilesPreview />;
  }
}

export default function FeatureCard({
  feature,
  index,
}: {
  feature: MainFeature;
  index: number;
}) {
  const visualFirst = index % 2 === 1;

  return (
    <article
      id={feature.id}
      aria-labelledby={`${feature.id}-title`}
      className="scroll-mt-28 border-b border-border py-14 sm:py-20"
    >
      <div className="grid gap-10 lg:grid-cols-[0.68fr_1.32fr] lg:items-center lg:gap-16">
        <div className={cn("max-w-md", visualFirst && "lg:order-last")}>
          <p className="mb-5 text-sm text-muted-foreground">
            {feature.eyebrow}
          </p>

          <h2
            id={`${feature.id}-title`}
            className="text-balance text-3xl font-medium leading-[1.05] tracking-[-0.04em] text-foreground md:text-4xl"
          >
            {feature.title}
          </h2>
          <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
            {marketingCopy.features.itemDescriptions[index]}
          </p>
        </div>

        <div className={cn("min-w-0", visualFirst && "lg:order-first")}>
          <div className="w-full">
            <FeaturePreview feature={feature} />
          </div>
        </div>
      </div>
    </article>
  );
}
