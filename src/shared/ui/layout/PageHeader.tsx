import * as React from "react";
import { cn } from "../classNames";
import { ActionBar, type ActionBarItem } from "./ActionBar";
import { OverflowFadeText } from "./OverflowFadeText";

export type PageHeaderProps = {
  /**
   * The page's name. Text fades when it doesn't fit. A node, such as a Space switcher menu, is
   * drawn as the heading as given and brings its own fading (MenuTrigger, OverflowFadeText).
   */
  title: React.ReactNode;
  /** The page's actions. They give way like any ActionBar, after the title has faded. */
  actions?: ReadonlyArray<ActionBarItem>;
  /** Accessible name of the actions toolbar. Default "Page actions". */
  actionsLabel?: string;
  /** Always shown after the actions and never folds, such as a search field. */
  end?: React.ReactNode;
  /** Layout only: margins or placement. */
  className?: string;
};

/**
 * A page's top band: 48px (`--ui-header`) with a hairline under it, the title on the left and the
 * page's actions on the right. The title fades first, down to a short stub, and only then do the
 * actions give way. It never wraps.
 */
export function PageHeader({
  title,
  actions,
  actionsLabel = "Page actions",
  end,
  className,
}: PageHeaderProps) {
  const hasActions = Boolean(actions?.length || end);
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex h-(--ui-header) min-w-0 shrink-0 items-center gap-3 border-b border-charcoal-border px-4",
        className,
      )}
    >
      {/* The title takes what the actions leave; it may not fade below 8rem before they give way. */}
      {typeof title === "string" || typeof title === "number" ? (
        <OverflowFadeText
          as="h1"
          full
          className="m-0 min-w-32 flex-1 text-page font-medium text-cream-bright"
        >
          {title}
        </OverflowFadeText>
      ) : (
        <h1 className="m-0 flex min-w-32 flex-1 items-center overflow-hidden text-page font-medium text-cream-bright">
          {title}
        </h1>
      )}
      {hasActions ? (
        <ActionBar label={actionsLabel} items={actions ?? []} end={end} width="content" />
      ) : null}
    </header>
  );
}
