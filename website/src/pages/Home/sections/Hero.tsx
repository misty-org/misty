import { type CSSProperties, useEffect, useRef, useState } from "react";

import { MistyAppMockup } from "@/components/marketing/appchrome";
import { ScreenshotSlot } from "@/components/marketing/previews";
import type { MarketingCopy } from "@/content/marketingCopy";
import { easeOut, useScrollProgress } from "@/hooks/useScrollProgress";
import { HomeCtaButtons } from "../components/HomeCtaButtons";

const TYPE_DELAY_MS = 110;
const DELETE_DELAY_MS = 70;
const WORD_HOLD_MS = 2_200;
const WORD_SWAP_MS = 320;

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

type TypingPhase = "typing" | "holding" | "deleting";

function useTypingRotation(words: readonly string[]) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [typedWord, setTypedWord] = useState(words[0] ?? "");
  const [phase, setPhase] = useState<TypingPhase>("holding");
  const [isInView, setIsInView] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) =>
      setPrefersReducedMotion(event.matches);

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { rootMargin: "120px" },
    );

    observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => setIsPageVisible(!document.hidden);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (
      prefersReducedMotion ||
      !isInView ||
      !isPageVisible ||
      words.length < 2
    ) {
      return;
    }

    const word = words[wordIndex] ?? "";
    let delay = TYPE_DELAY_MS;
    let advance = () => setTypedWord(word.slice(0, typedWord.length + 1));

    if (phase === "holding") {
      delay = WORD_HOLD_MS;
      advance = () => setPhase("deleting");
    } else if (phase === "deleting" && typedWord.length > 0) {
      delay = DELETE_DELAY_MS;
      advance = () => setTypedWord(word.slice(0, typedWord.length - 1));
    } else if (phase === "deleting") {
      delay = WORD_SWAP_MS;
      advance = () => {
        setWordIndex((index) => (index + 1) % words.length);
        setPhase("typing");
      };
    } else if (typedWord.length >= word.length) {
      advance = () => setPhase("holding");
    }

    const timeout = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timeout);
  }, [
    isInView,
    isPageVisible,
    phase,
    prefersReducedMotion,
    typedWord,
    wordIndex,
    words,
  ]);

  return {
    headingRef,
    isWordComplete: prefersReducedMotion || phase === "holding",
    typedWord: prefersReducedMotion ? (words[0] ?? "") : typedWord,
  };
}

export function Hero({ copy }: { copy: MarketingCopy["home"] }) {
  const { ref: scrollRef, progress } = useScrollProgress<HTMLDivElement>();
  const { headingRef, isWordComplete, typedWord } = useTypingRotation(
    copy.heroTitleWords,
  );
  const longestWord = copy.heroTitleWords.reduce(
    (longest, word) => (word.length > longest.length ? word : longest),
    "",
  );
  const copyProgress = easeOut(clamp(progress / 0.06));
  // Finish the screenshot expansion before the sticky hero releases so the
  // completed product view has a short, deliberate hold as scrolling continues.
  const expansionProgress = clamp((progress - 0.02) / 0.78);
  const copyOpacity = 1 - copyProgress;
  const scrollStyle = {
    "--hero-copy-column": `${38 * (1 - expansionProgress)}%`,
    "--hero-copy-opacity": copyOpacity,
    "--hero-copy-shift": `${-1.25 * copyProgress}rem`,
    "--hero-grid-gap": `${3.5 * (1 - expansionProgress)}rem`,
    "--hero-shot-width": `${112 - 12 * expansionProgress}%`,
    "--hero-shot-scale": 0.98 + 0.02 * expansionProgress,
  } as CSSProperties;

  return (
    <section className="home-content-rail relative overflow-x-clip">
      <div ref={scrollRef} className="hero-scroll-track">
        <div className="hero-scroll-stage">
          <div
            className="hero-scroll-layout site-container grid min-h-[calc(100svh-var(--site-nav-height))] items-center gap-10 py-4 md:grid-cols-[minmax(0,0.76fr)_minmax(0,1.24fr)] md:py-6 lg:gap-14"
            style={scrollStyle}
          >
            <div
              className="hero-scroll-copy relative z-10 flex min-w-0 flex-col items-start text-left"
              aria-hidden={copyOpacity < 0.05}
              inert={copyOpacity < 0.05 ? true : undefined}
            >
              <h1
                ref={headingRef}
                aria-label={copy.heroTitle}
                className="hero-animate w-fit max-w-full text-[clamp(2.25rem,5.2vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--marketing-foreground)]"
              >
                <span aria-hidden="true">
                  <span className="block text-[var(--marketing-muted)]">
                    {copy.heroTitleLead}
                  </span>
                  <span className="mt-1 inline-grid max-w-full text-left text-[var(--marketing-foreground)] [grid-template-areas:'word']">
                    <span
                      className="invisible [grid-area:word]"
                      aria-hidden="true"
                    >
                      {longestWord}
                    </span>
                    <span className="whitespace-nowrap [grid-area:word]">
                      {typedWord}
                      <span
                        className={`typing-cursor${isWordComplete ? " typing-cursor-blinking" : ""}`}
                        aria-hidden="true"
                      />
                    </span>
                  </span>
                </span>
              </h1>

              <HomeCtaButtons className="hero-animate hero-animate-delay-2 mt-8 justify-start" />
            </div>

            <div className="hero-scroll-shot pointer-events-none min-w-0">
              <ScreenshotSlot slot="home-dashboard" eager>
                <MistyAppMockup
                  view="space"
                  bodyClass="h-[300px] sm:h-[380px] lg:h-[440px]"
                />
              </ScreenshotSlot>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
