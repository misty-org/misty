import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { MainFeature } from "./featureData";

export default function FeatureCard({ feature }: { feature: MainFeature }) {
  const [failed, setFailed] = useState(false);
  const Icon = feature.Icon;
  const showImage = feature.imageSrc && !failed;

  return (
    <Card
      role="article"
      className="group min-h-[560px] gap-0 rounded-xl bg-card py-0 shadow-lg transition-colors hover:bg-accent/20"
    >
      <div className="relative aspect-video overflow-hidden border-b border-border bg-muted/40">
        {showImage ? (
          <img
            src={feature.imageSrc}
            alt={feature.imageAlt}
            className="block h-full w-full object-cover object-top"
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,var(--muted),transparent_68%)]">
            <Icon className="h-14 w-14 text-muted-foreground/60" />
          </div>
        )}
      </div>

      <CardContent className="flex flex-1 flex-col p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {feature.eyebrow}
          </p>
        </div>

        <h3 className="text-3xl font-bold tracking-tight text-foreground">{feature.title}</h3>
        <p className="mt-4 text-base leading-7 text-muted-foreground">{feature.description}</p>

        <div className="mt-auto grid gap-3 pt-8">
          {feature.details.map((detail) => (
            <div key={detail} className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="h-px w-5 bg-border" />
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
