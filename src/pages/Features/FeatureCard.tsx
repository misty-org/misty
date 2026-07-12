import { useState } from "react";
import type { MainFeature } from "./featureData";

export default function FeatureCard({ feature }: { feature: MainFeature }) {
  const [failed, setFailed] = useState(false);
  const Icon = feature.Icon;
  const showImage = feature.imageSrc && !failed;

  return (
    <article className="group flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0d0f] shadow-[0_22px_70px_rgba(0,0,0,0.22)] transition-colors hover:border-white/18 hover:bg-[#0e1114]">
      <div className="relative aspect-video overflow-hidden border-b border-white/10 bg-[#101215]">
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
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_58%)]">
            <Icon className="h-14 w-14 text-white/45" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface">
            <Icon className="h-5 w-5 text-text-muted" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted/60">
            {feature.eyebrow}
          </p>
        </div>

        <h3 className="text-3xl font-bold tracking-tight text-text">{feature.title}</h3>
        <p className="mt-4 text-base leading-7 text-text-muted">{feature.description}</p>

        <div className="mt-auto grid gap-3 pt-8">
          {feature.details.map((detail) => (
            <div key={detail} className="flex items-center gap-3 text-sm text-text-muted">
              <span className="h-px w-5 bg-white/30" />
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
