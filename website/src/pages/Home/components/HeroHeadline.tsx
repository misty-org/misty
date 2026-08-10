import type { MarketingCopy } from "@/content/marketingCopy";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useTypedPhrase } from "../hooks/useTypedPhrase";
import { SpacesLink } from "./SpacesLink";

const headlineType =
  "text-5xl font-medium leading-[0.98] tracking-[-0.055em] text-foreground sm:text-6xl lg:text-7xl";

export function HeroHeadline({
  heroTitle,
}: {
  heroTitle: MarketingCopy["home"]["heroTitle"];
}) {
  const { before, link, after, phrases } = heroTitle;
  const reducedMotion = usePrefersReducedMotion();
  const typed = useTypedPhrase(phrases, !reducedMotion);

  // The tallest phrase reserves the row so the hero never reflows mid-cycle.
  const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a));

  return (
    <div className="grid">
      <span
        aria-hidden="true"
        className={`invisible col-start-1 row-start-1 ${headlineType}`}
      >
        {before}
        {link}
        {after}
        {longest}
      </span>
      <h1 className={`col-start-1 row-start-1 ${headlineType}`}>
        {before}
        <SpacesLink>{link}</SpacesLink>
        {after}
        {/* Stable accessible name; the animated copy below is decorative. */}
        <span className="sr-only">{phrases[0]}</span>
        <span aria-hidden="true">
          {typed}
          {reducedMotion ? null : (
            <span className="ml-[0.06em] inline-block h-[0.78em] w-[0.055em] translate-y-[0.06em] animate-[caret-blink_1.1s_steps(1)_infinite] bg-foreground align-baseline" />
          )}
        </span>
      </h1>
    </div>
  );
}
