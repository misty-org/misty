import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import { mainFeatures, type MainFeature } from "../Features/featureData";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function useCompactViewport() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const update = () => setCompact(window.innerWidth < 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return compact;
}

function FeatureMedia({
  feature,
}: {
  feature: MainFeature;
}) {
  const Icon = feature.Icon;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = feature.imageSrc && !imageFailed;

  return (
    <div className="relative aspect-video overflow-hidden border-b border-white/10 bg-[#101215]">
      {showImage ? (
        <img
          src={feature.imageSrc}
          alt={feature.imageAlt}
          className="block h-full w-full object-contain object-top"
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_58%)]">
          <Icon className="h-10 w-10 text-white/45" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d0f]/24 via-transparent to-[#0b0d0f]/12" />
    </div>
  );
}

function ActiveDemoCard({ feature, compact }: { feature: MainFeature; compact: boolean }) {
  const Icon = feature.Icon;

  return (
    <article
      className="absolute left-1/2 z-30 flex origin-center -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-white/20 bg-[#0b0d0f] shadow-[0_30px_90px_rgba(0,0,0,0.48)]"
      style={{
        top: compact ? "43%" : "42%",
        width: compact ? "calc(100vw - 56px)" : "min(1120px, calc(100vw - 240px))",
      }}
    >
      <FeatureMedia feature={feature} />

      <div className="flex h-[76px] shrink-0 items-center justify-between gap-4 px-4 md:h-[86px] md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface">
            <Icon className="h-4 w-4 text-text-muted" />
          </div>
          <h3 className="truncate text-base font-semibold text-text md:text-lg">{feature.title}</h3>
        </div>
        <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted/50 sm:block">
          {feature.eyebrow}
        </span>
      </div>
    </article>
  );
}

function HandCard({
  feature,
  index,
  active,
  total,
  compact,
  exitProgress,
  onSelect,
}: {
  feature: MainFeature;
  index: number;
  active: boolean;
  total: number;
  compact: boolean;
  exitProgress: number;
  onSelect: () => void;
}) {
  const Icon = feature.Icon;
  const centerOffset = index - (total - 1) / 2;
  const fanRotation = centerOffset * (compact ? 6 : 7);
  const fanX = centerOffset * (compact ? 48 : 96);
  const cardWidth = compact ? "168px" : "238px";
  const cardHeight = compact ? "224px" : "320px";
  const exitDirection = centerOffset === 0 ? 0 : Math.sign(centerOffset);
  const exitX = exitProgress * exitDirection * (compact ? 90 : 180);
  const exitY = exitProgress * (compact ? 250 : 390);
  const exitRotation = exitProgress * exitDirection * (compact ? 10 : 14);
  const visibleOpacity = active ? 1 : 0.74;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Show ${feature.title}`}
      aria-current={active ? "true" : undefined}
      className="absolute bottom-0 left-1/2 flex origin-bottom flex-col overflow-hidden rounded-xl border bg-[#0b0d0f] text-left shadow-[0_24px_70px_rgba(0,0,0,0.42)] transition-[border-color,box-shadow,opacity,transform] duration-300 hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      style={{
        width: cardWidth,
        height: cardHeight,
        zIndex: active ? 30 + index : 10 + index,
        transform: `translate3d(calc(-50% + ${fanX + exitX}px), ${Math.abs(centerOffset) * (compact ? 8 : 10) + exitY}px, 0) rotate(${fanRotation + exitRotation}deg) scale(${active ? 1.02 : 0.94})`,
        opacity: visibleOpacity * (1 - exitProgress),
        borderColor: active ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.12)",
      }}
    >
      <div className="flex h-full min-w-0 flex-col justify-between p-4 md:p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface md:h-12 md:w-12">
          <Icon className="h-4 w-4 text-text-muted md:h-5 md:w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-text md:text-2xl">{feature.title}</h3>
          <p className="mt-2 truncate text-[10px] uppercase tracking-[0.14em] text-text-muted/50 md:text-[11px]">
            {feature.eyebrow}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function ProductScrollShowcase() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const compactViewport = useCompactViewport();

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    let frame = 0;

    function updateProgress() {
      frame = 0;
      const section = sectionRef.current;
      if (!section) {
        return;
      }

      const rect = section.getBoundingClientRect();
      const scrollable = Math.max(1, rect.height - window.innerHeight);
      setProgress(clamp(-rect.top / scrollable, 0, 1));
    }

    function requestUpdate() {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(updateProgress);
    }

    updateProgress();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [reducedMotion]);

  const sequenceProgress = clamp(progress * mainFeatures.length, 0, mainFeatures.length - 0.001);
  const activeIndex = Math.floor(sequenceProgress);
  const activeFeature = mainFeatures[activeIndex] ?? mainFeatures[0];
  const showMoreLink = progress > 0.86;
  const introOpacity = clamp(1 - progress * 4, 0, 1);
  const handExitProgress = clamp((progress - 0.9) / 0.1, 0, 1);

  function scrollToFeature(index: number) {
    const section = sectionRef.current;
    if (!section) {
      return;
    }

    const rect = section.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const scrollable = Math.max(1, section.offsetHeight - window.innerHeight);
    const targetProgress = (index + 0.5) / mainFeatures.length;
    window.scrollTo({
      top: top + scrollable * targetProgress,
      behavior: "smooth",
    });
  }

  if (reducedMotion) {
    return (
      <section className="relative w-full overflow-hidden py-10 text-center md:py-18" data-showcase-root>
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-text-muted/70">Main features</p>
          <h2 className="text-4xl font-bold tracking-tight text-text md:text-6xl">The pieces that make Misty useful.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-8 text-text-muted">
            Six core workflows work together: find files, split work into panels, connect remotes, move data, extend the app, and ask MistyAI for help.
          </p>
          <NavLink
            to="/features"
            className="mt-8 inline-flex items-center justify-center rounded-full border border-white/15 bg-white px-5 py-2 text-sm font-semibold text-black shadow-lg transition-colors hover:bg-zinc-200"
          >
            More features
          </NavLink>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative w-full py-10 md:py-18"
      data-showcase-root
    >
      <div
        ref={sectionRef}
        className="relative"
        style={{ minHeight: `${mainFeatures.length * 170 + 120}vh` }}
      >
        <div className="sticky top-0 flex min-h-screen flex-col items-center overflow-hidden pt-12 md:pt-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_68%)]" />

          <div
            className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-2 text-center transition-opacity duration-300"
            style={{ opacity: introOpacity }}
          >
            <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-text-muted/70">Main features</p>
            <h2 className="max-w-4xl text-3xl font-bold leading-tight tracking-tight text-text sm:text-4xl md:text-6xl">
              Pull the best parts of Misty from the deck.
            </h2>
          </div>

          <div className="relative z-50 mx-auto mt-8 flex w-full max-w-5xl flex-col items-center px-2 text-center md:mt-10">
            <div
              className={`mt-5 transition-all duration-500 ${showMoreLink ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
              aria-hidden={!showMoreLink}
            >
              <NavLink
                to="/features"
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white px-5 py-2 text-sm font-semibold text-black shadow-lg transition-colors hover:bg-zinc-200"
              >
                More features
              </NavLink>
            </div>
          </div>

          <ActiveDemoCard feature={activeFeature} compact={compactViewport} />

          <div
            className="absolute inset-x-0 bottom-0 z-50 mx-auto h-[258px] max-w-[1420px] md:h-[386px]"
            style={{ pointerEvents: handExitProgress > 0.9 ? "none" : "auto" }}
          >
            {mainFeatures.map((feature, index) => (
              <HandCard
                key={feature.title}
                feature={feature}
                index={index}
                active={index === activeIndex}
                total={mainFeatures.length}
                compact={compactViewport}
                exitProgress={handExitProgress}
                onSelect={() => scrollToFeature(index)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
