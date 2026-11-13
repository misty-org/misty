import type { ReactNode } from "react";

import { BackButton } from "../controls/BackButton";
import { StepProgress } from "../feedback/StepProgress";
import { PageEnter } from "../layout/PageEnter";

export type StepPageProps = {
  /** The bar floating over the page, such as the signed-out pages' nav. */
  nav?: ReactNode;
  /** What the steps are of, for screen readers, such as "Setup steps". */
  label: string;
  /** How many steps there are. */
  steps: number;
  /** The step shown, from 0. */
  current: number;
  /** Goes to the step before; Back shows only when it is given. */
  onBack?: () => void;
  /** The step's heading. It rises into place again each time it changes. */
  title: string;
  /** The step's content, under its heading. */
  children: ReactNode;
  /** The buttons that move on, at the bottom right: the primary one last. */
  actions: ReactNode;
};

/**
 * A page of a few steps on the window's surface, such as first-run setup: Back and the steps'
 * progress, the step's heading, its content in one centered column, and the buttons that move on.
 * The page scrolls when the step is taller than the window.
 *
 * ```tsx
 * <StepPage nav={<WelcomeNav />} label="Setup steps" steps={3} current={index}
 *   onBack={index > 0 ? back : undefined} title={step.title} actions={<Button …>Continue</Button>}>
 *   {content}
 * </StepPage>
 * ```
 */
export function StepPage(props: StepPageProps) {
  return (
    <div className="relative grid h-full min-h-0 overflow-y-auto bg-window-chrome px-6 pb-10 pt-24">
      {props.nav}
      <PageEnter className="mx-auto flex w-full max-w-140 flex-col gap-6 self-start">
        <div className="flex items-center gap-3">
          {props.onBack ? <BackButton onClick={props.onBack} /> : null}
          <StepProgress label={props.label} steps={props.steps} current={props.current} />
        </div>
        <PageEnter
          as="h1"
          key={props.title}
          className="text-3xl font-medium leading-tight tracking-[-0.025em] text-cream-bright"
        >
          {props.title}
        </PageEnter>
        {props.children}
        <div className="flex items-center justify-end gap-2 pt-2">{props.actions}</div>
      </PageEnter>
    </div>
  );
}
