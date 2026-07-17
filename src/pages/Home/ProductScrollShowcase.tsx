import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import { featureChapters, type MainFeature } from "../Features/featureData";
import PositioningBridge from "./PositioningBridge";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const chapterTransitionSpan = 0.12;
const showcaseStoryEnd = 0.94;
const scrollVhPerFeature = 120;
const totalFeatureCount = featureChapters.reduce((total, chapter) => total + chapter.features.length, 0);

function chapterStartUnit(chapterIndex: number) {
  return featureChapters
    .slice(0, chapterIndex)
    .reduce((total, chapter) => total + chapter.features.length, 0);
}

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

function ActiveDemoCard({
  feature,
  compact,
  exitProgress,
  fastExit,
}: {
  feature: MainFeature;
  compact: boolean;
  exitProgress: number;
  fastExit: boolean;
}) {
  return (
    <article
      className={`absolute left-1/2 z-30 flex origin-center -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-white/20 bg-[#0b0d0f] shadow-[0_30px_90px_rgba(0,0,0,0.48)] transition-opacity duration-700 ${fastExit ? "[animation:none]" : "[animation:showcase-card-reveal_700ms_cubic-bezier(0.16,1,0.3,1)]"}`}
      style={{
        top: compact ? "calc(38% - 34px)" : "calc(50% - 37px)",
        width: compact
          ? "calc(100vw - 32px)"
          : "min(1420px, calc(100vw - 64px), calc(112vh - 132px))",
        opacity: 1 - exitProgress,
        pointerEvents: exitProgress > 0.9 ? "none" : "auto",
        transitionDuration: fastExit ? "180ms" : "700ms",
      }}
    >
      <FeatureMedia feature={feature} />
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
  fastExit,
  onSelect,
}: {
  feature: MainFeature;
  index: number;
  active: boolean;
  total: number;
  compact: boolean;
  exitProgress: number;
  fastExit: boolean;
  onSelect: () => void;
}) {
  const centerOffset = index - (total - 1) / 2;
  const normalizedOffset = total > 1 ? centerOffset / ((total - 1) / 2) : 0;
  const fanRotation = normalizedOffset * (compact ? 15 : 18);
  const fanX = centerOffset * (compact ? 62 : 170);
  const fanY = Math.abs(normalizedOffset) * (compact ? 24 : 58);
  const cardWidth = compact ? "188px" : "320px";
  const cardHeight = compact ? "180px" : "260px";
  const exitDirection = centerOffset === 0 ? 0 : Math.sign(centerOffset);
  const exitX = exitProgress * exitDirection * (compact ? 90 : 180);
  const exitY = exitProgress * (compact ? 250 : 390);
  const exitRotation = exitProgress * exitDirection * (compact ? 10 : 14);
  const visibleOpacity = active ? 1 : 0.9;
  const handStack = 20 + index;
  const characterPopped = Boolean(feature.characterSrc) && active && exitProgress < 0.18;

  return (
    <div
      className="absolute bottom-0 left-1/2 origin-bottom transition-[opacity,transform] duration-700 ease-out"
      style={{
        width: cardWidth,
        height: cardHeight,
        zIndex: handStack,
        transform: `translate3d(calc(-50% + ${fanX + exitX}px), ${fanY + exitY}px, 0) rotate(${fanRotation + exitRotation}deg) scale(${active ? 1 : 0.96})`,
        opacity: visibleOpacity * (1 - exitProgress),
        transitionDuration: fastExit ? "180ms" : "700ms",
      }}
    >
      {feature.characterSrc ? (
        <img
          src={feature.characterSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute left-1/2 z-0 select-none object-contain drop-shadow-[0_12px_24px_rgba(18,92,150,0.3)] transition-[opacity,transform] duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none"
          decoding="async"
          style={{
            top: compact ? "-42px" : "-62px",
            width: compact ? "88px" : "118px",
            height: compact ? "74px" : "98px",
            opacity: characterPopped ? 1 : 0,
            transform: characterPopped
              ? "translateX(-50%) translateY(0) scale(1) rotate(-2deg)"
              : "translateX(-50%) translateY(46px) scale(0.82) rotate(-2deg)",
          }}
        />
      ) : null}

      <button
        type="button"
        onClick={onSelect}
        aria-label={`Show ${feature.title}`}
        aria-current={active ? "true" : undefined}
        className="relative z-10 flex h-full w-full flex-col overflow-hidden rounded-xl border bg-[#0b0d0f] text-left shadow-[0_24px_70px_rgba(0,0,0,0.42)] transition-[border-color,box-shadow] duration-500 hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        style={{
          borderColor: active ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.12)",
        }}
      >
        {feature.imageSrc ? (
          <img
            src={feature.imageSrc}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div className="absolute inset-0 bg-[#0b0d0f]/20" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#0b0d0f]/48 to-transparent" />
        <div className="flex h-full min-w-0 flex-col justify-start p-4 pt-6 md:p-5 md:pt-7">
          <div className="relative min-w-0">
            <h3 className="truncate text-lg font-semibold text-text md:text-2xl">{feature.title}</h3>
          </div>
        </div>
      </button>
    </div>
  );
}

export default function ProductScrollShowcase() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [nextSectionHandoffProgress, setNextSectionHandoffProgress] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const compactViewport = useCompactViewport();

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    let frame = 0;
    const nextSection = document.querySelector("[data-showcase-next]");

    function updateProgress() {
      frame = 0;
      const section = sectionRef.current;
      if (!section) {
        return;
      }

      const rect = section.getBoundingClientRect();
      const scrollable = Math.max(1, rect.height - window.innerHeight);
      setProgress(clamp(-rect.top / scrollable, 0, 1));

      if (nextSection) {
        const nextSectionTop = nextSection.getBoundingClientRect().top;
        const fadeStart = window.innerHeight * 0.9;
        const fadeEnd = window.innerHeight * 0.18;
        setNextSectionHandoffProgress(
          clamp((fadeStart - nextSectionTop) / (fadeStart - fadeEnd), 0, 1),
        );
      }
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

  const storyProgress = clamp(progress / showcaseStoryEnd, 0, 1);
  const sequenceProgress = clamp(storyProgress * totalFeatureCount, 0, totalFeatureCount - 0.001);
  const activeChapterIndex = Math.max(
    0,
    featureChapters.findIndex((_, index) => sequenceProgress < chapterStartUnit(index + 1)),
  );
  const activeChapter = featureChapters[activeChapterIndex] ?? featureChapters[0];
  const activeChapterStart = chapterStartUnit(activeChapterIndex);
  const chapterProgress = clamp(
    (sequenceProgress - activeChapterStart) / activeChapter.features.length,
    0,
    1,
  );
  const chapterEntranceProgress = activeChapterIndex === 0
    ? 0
    : clamp((chapterTransitionSpan - chapterProgress) / chapterTransitionSpan, 0, 1);
  const chapterExitProgress = activeChapterIndex === featureChapters.length - 1
    ? 0
    : clamp(
        (chapterProgress - (1 - chapterTransitionSpan)) / chapterTransitionSpan,
        0,
        1,
      );
  const chapterEdgeProgress = Math.max(chapterEntranceProgress, chapterExitProgress);
  const featureWindowProgress = clamp(
    (chapterProgress - chapterTransitionSpan) / (1 - chapterTransitionSpan * 2),
    0,
    0.999,
  );
  const activeFeatureIndex = Math.min(
    Math.floor(featureWindowProgress * activeChapter.features.length),
    activeChapter.features.length - 1,
  );
  const activeFeature = activeChapter.features[activeFeatureIndex] ?? activeChapter.features[0];
  const showcaseReleaseProgress = clamp((progress - 0.992) / 0.004, 0, 1);
  const fastExit = showcaseReleaseProgress > 0;
  const visibleChapterExitProgress = Math.max(
    chapterEdgeProgress,
    nextSectionHandoffProgress,
    showcaseReleaseProgress,
  );

  function scrollToProgress(targetProgress: number) {
    const section = sectionRef.current;
    if (!section) {
      return;
    }

    const rect = section.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const scrollable = Math.max(1, section.offsetHeight - window.innerHeight);
    window.scrollTo({
      top: top + scrollable * clamp(targetProgress, 0, 1),
      behavior: "smooth",
    });
  }

  function scrollToChapter(index: number) {
    const chapter = featureChapters[index];
    if (!chapter) {
      return;
    }

    const targetUnit = chapterStartUnit(index) + chapter.features.length * (chapterTransitionSpan + 0.02);
    scrollToProgress(showcaseStoryEnd * targetUnit / totalFeatureCount);
  }

  function scrollToFeature(index: number) {
    const featureCenter = (index + 0.5) / activeChapter.features.length;
    const targetChapterProgress = chapterTransitionSpan
      + featureCenter * (1 - chapterTransitionSpan * 2);
    const targetUnit = activeChapterStart + targetChapterProgress * activeChapter.features.length;
    scrollToProgress(showcaseStoryEnd * targetUnit / totalFeatureCount);
  }

  if (reducedMotion) {
    return (
      <section className="relative w-full overflow-hidden py-10 text-center md:py-18" data-showcase-root>
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-text-muted/70">How Misty works</p>
          <h2 className="text-4xl font-bold tracking-tight text-text md:text-6xl">
            Files <span className="text-text-muted/30">&rarr;</span> Space{" "}
            <span className="text-text-muted/30">&rarr;</span> Intelligence
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-8 text-text-muted">
            Files become shared context in a Space. Intelligence turns that context into assistance, workflows, and agents.
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
      className="relative w-full"
      data-showcase-root
    >
      <div
        ref={sectionRef}
        className="relative"
        style={{ minHeight: `${totalFeatureCount * scrollVhPerFeature + 120}vh` }}
      >
        <div
          className="sticky top-0 flex h-screen w-screen flex-col items-center overflow-hidden pt-20"
          style={{ marginLeft: "calc(50% - 50vw)" }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.075),transparent_68%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-60 bg-gradient-to-b from-[#090b0d] via-[#090b0d]/85 to-transparent" />

          <div
            className="relative z-[70] w-full transition-opacity duration-700"
            style={{
              opacity: 1 - visibleChapterExitProgress,
              transitionDuration: fastExit ? "180ms" : "700ms",
            }}
          >
            <PositioningBridge
              stages={featureChapters.map((chapter) => chapter.title)}
              activeIndex={activeChapterIndex}
              onSelect={scrollToChapter}
            />
          </div>

          <ActiveDemoCard
            key={`${activeChapter.id}-${activeFeature.title}`}
            feature={activeFeature}
            compact={compactViewport}
            exitProgress={visibleChapterExitProgress}
            fastExit={fastExit}
          />

          {progress < 0.997 ? (
            <div
              className="absolute inset-x-0 bottom-0 z-50 mx-auto h-[224px] max-w-[1420px] md:-bottom-6 md:h-[304px]"
              style={{ pointerEvents: visibleChapterExitProgress > 0.9 ? "none" : "auto" }}
            >
              {activeChapter.features.map((feature, index) => (
                <HandCard
                  key={`${activeChapter.id}-${feature.title}`}
                  feature={feature}
                  index={index}
                  active={index === activeFeatureIndex}
                  total={activeChapter.features.length}
                  compact={compactViewport}
                  exitProgress={visibleChapterExitProgress}
                  fastExit={fastExit}
                  onSelect={() => scrollToFeature(index)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
