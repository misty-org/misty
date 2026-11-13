import type { ReactNode } from "react";

import { BackButton } from "../controls/BackButton";
import { PageEnter } from "../layout/PageEnter";

export type HeroPageProps = {
  /** Drawn behind everything, such as Misty drifting around the page. */
  backdrop?: ReactNode;
  /** The bar floating over the page, such as the signed-out pages' nav. */
  nav?: ReactNode;
  /** Goes back to the page that asked; Back shows at the top-left, under the bar, when given. */
  onBack?: () => void;
  /** The large heading. */
  title: string;
  /** The muted line that finishes the heading, such as the product's tagline. */
  tagline?: string;
  /** The page's buttons, centered under the heading. */
  actions: ReactNode;
  /** The small print at the start of the bottom line, such as the copyright. */
  footnote?: ReactNode;
  /** The small print at its end, such as the terms. */
  legal?: ReactNode;
};

/**
 * A page that greets, such as the first-run welcome: a large heading with its tagline and the
 * page's buttons in the middle of the window, and a line of small print along the bottom. The
 * heading grows with the window.
 *
 * ```tsx
 * <HeroPage backdrop={<FlyingMisty />} nav={<WelcomeNav />} title="Welcome to Misty"
 *   tagline="Build together with AI." actions={buttons} footnote="© 2026 Misty" />
 * ```
 */
export function HeroPage(props: HeroPageProps) {
  return (
    <div className="relative grid h-full min-h-0 place-items-center bg-window-chrome px-6 pb-14 pt-16 text-center">
      {props.backdrop}
      {props.nav}
      {props.onBack ? (
        <BackButton className="absolute left-4 top-17 z-10 sm:left-8" onClick={props.onBack} />
      ) : null}
      <PageEnter className="relative z-10 flex flex-col items-center gap-[0.85em] text-[clamp(2.25rem,4.5vw,3.5rem)]">
        <h1 className="font-medium leading-[1.25] tracking-[-0.035em] text-cream-bright">
          {props.title}
          {props.tagline ? (
            <span className="block font-normal text-cream-muted">{props.tagline}</span>
          ) : null}
        </h1>
        <div className="flex flex-wrap items-center justify-center gap-3">{props.actions}</div>
      </PageEnter>
      {props.footnote || props.legal ? (
        <PageEnter
          as="footer"
          className={
            "absolute inset-x-4 bottom-4 mx-auto flex max-w-5xl flex-wrap items-center " +
            "justify-between gap-x-6 gap-y-1 px-4 text-caption text-cream-muted sm:inset-x-8"
          }
        >
          {props.footnote ? <span>{props.footnote}</span> : null}
          {props.legal ? <p className="leading-5">{props.legal}</p> : null}
        </PageEnter>
      ) : null}
    </div>
  );
}
