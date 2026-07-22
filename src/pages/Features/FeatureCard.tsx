import {
  ChatPreview,
  ConnectionsPreview,
  FilesPreview,
  MikaPreview,
  ProductScreenshot,
} from "@/components/ProductPreview";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MainFeature } from "./featureData";

function FeaturePreview({ feature }: { feature: MainFeature }) {
  switch (feature.id) {
    case "work-together":
      return <ChatPreview />;
    case "shared-library":
      return (
        <ProductScreenshot
          src="/space-library-crop.webp"
          alt="Misty Space Library showing shared project research and files"
          label="Space Library · Beta"
        />
      );
    case "integrations":
      return <ConnectionsPreview />;
    case "mika":
      return <MikaPreview />;
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
    <Card
      id={feature.id}
      role="article"
      aria-labelledby={`${feature.id}-title`}
      className="scroll-mt-28 gap-0 overflow-hidden py-0 shadow-sm"
    >
      <div className="grid lg:grid-cols-[0.65fr_1.35fr]">
        <CardContent className="flex flex-col justify-center px-6 py-8 sm:px-8 sm:py-10 lg:min-h-[25rem] lg:px-10">
          <div className="mb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {feature.eyebrow}
            </p>
          </div>

          <h2
            id={`${feature.id}-title`}
            className="max-w-lg text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl"
          >
            {feature.title}
          </h2>
          <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
            {feature.description}
          </p>
        </CardContent>

        <div
          className={cn(
            "flex items-center border-t border-border bg-muted/20 p-4 sm:p-6 lg:min-h-[25rem] lg:border-t-0 lg:p-8",
            visualFirst ? "lg:order-first lg:border-r" : "lg:border-l",
          )}
        >
          <div className="w-full">
            <FeaturePreview feature={feature} />
          </div>
        </div>
      </div>
    </Card>
  );
}
