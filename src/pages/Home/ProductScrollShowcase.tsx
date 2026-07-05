import { useState } from "react";
import {
  HiOutlineArrowsRightLeft,
  HiOutlineCircleStack,
  HiOutlineCloud,
  HiOutlineMagnifyingGlass,
  HiOutlinePuzzlePiece,
  HiOutlineSparkles,
} from "react-icons/hi2";
import type { IconType } from "react-icons";

const PUBLIC_ASSET_BASE_URL =
  import.meta.env.VITE_PUBLIC_ASSET_BASE_URL || "https://public.mistysys.com";

type MainFeature = {
  title: string;
  eyebrow: string;
  description: string;
  details: string[];
  imageSrc: string;
  imageAlt: string;
  Icon: IconType;
};

const mainFeatures: MainFeature[] = [
  {
    title: "Search",
    eyebrow: "Find anything",
    description: "Search local folders and connected storage from one place without thinking about where a file lives.",
    details: ["Unified results", "Provider-aware context", "Fast recall"],
    imageSrc: `${PUBLIC_ASSET_BASE_URL}/features/search.png`,
    imageAlt: "Misty search feature screenshot",
    Icon: HiOutlineMagnifyingGlass,
  },
  {
    title: "Panels",
    eyebrow: "Work side by side",
    description: "Use multiple panels to compare folders, stage moves, and keep source and destination visible.",
    details: ["Multi-pane workspace", "Compare locations", "Fewer window swaps"],
    imageSrc: `${PUBLIC_ASSET_BASE_URL}/features/panels.png`,
    imageAlt: "Misty panels feature screenshot",
    Icon: HiOutlineCircleStack,
  },
  {
    title: "Remotes",
    eyebrow: "Connect storage",
    description: "Bring cloud accounts, servers, and remote providers into the same file-management surface.",
    details: ["Cloud providers", "Remote paths", "rclone-backed setup"],
    imageSrc: `${PUBLIC_ASSET_BASE_URL}/features/remotes.png`,
    imageAlt: "Misty remotes feature screenshot",
    Icon: HiOutlineCloud,
  },
  {
    title: "Transfers",
    eyebrow: "Move with confidence",
    description: "Keep file movement visible with transfer progress that continues while you keep working.",
    details: ["Background queue", "Progress states", "Cross-provider movement"],
    imageSrc: `${PUBLIC_ASSET_BASE_URL}/features/transfers.png`,
    imageAlt: "Misty transfers feature screenshot",
    Icon: HiOutlineArrowsRightLeft,
  },
  {
    title: "Extensions",
    eyebrow: "Add tools",
    description: "Extend Misty with focused tools and panels that fit the way your files need to be handled.",
    details: ["Plugin catalog", "Installed tools", "Workflow add-ons"],
    imageSrc: `${PUBLIC_ASSET_BASE_URL}/features/extensions.png`,
    imageAlt: "Misty extensions feature screenshot",
    Icon: HiOutlinePuzzlePiece,
  },
  {
    title: "AI",
    eyebrow: "Ask in context",
    description: "Use MistyAI to ask questions and reason over the files and workspace already in front of you.",
    details: ["Context-aware help", "File questions", "Action-ready answers"],
    imageSrc: `${PUBLIC_ASSET_BASE_URL}/features/ai.png`,
    imageAlt: "Misty AI feature screenshot",
    Icon: HiOutlineSparkles,
  },
];

function FeatureImage({ feature }: { feature: MainFeature }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-white/10 bg-[#101215]">
      <img
        src={feature.imageSrc}
        alt={feature.imageAlt}
        className="block h-full w-full object-cover object-top"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function FeatureCard({ feature }: { feature: MainFeature }) {
  const Icon = feature.Icon;

  return (
    <article className="group flex min-h-[430px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0d0f] shadow-[0_22px_70px_rgba(0,0,0,0.22)] transition-colors hover:border-white/18 hover:bg-[#0e1114]">
      <FeatureImage feature={feature} />
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface">
            <Icon className="h-5 w-5 text-text-muted" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted/60">
            {feature.eyebrow}
          </p>
        </div>

        <h3 className="text-2xl font-bold tracking-tight text-text">{feature.title}</h3>
        <p className="mt-3 text-sm leading-6 text-text-muted">{feature.description}</p>

        <div className="mt-auto grid gap-2.5 pt-6">
          {feature.details.map((detail) => (
            <div key={detail} className="flex items-center gap-2.5 text-xs text-text-muted">
              <span className="h-px w-4 bg-white/30" />
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function ProductScrollShowcase() {
  return (
    <section className="relative w-full overflow-hidden py-10 md:py-18" data-showcase-root>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_68%)]" />

      <div className="relative">
        <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
          <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-text-muted/70">Main features</p>
          <h2 className="text-4xl font-bold tracking-tight text-text md:text-6xl">The pieces that make Misty useful.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-8 text-text-muted">
            Six core workflows work together: find files, split work into panels, connect remotes, move data, extend the app, and ask MistyAI for help.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mainFeatures.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
