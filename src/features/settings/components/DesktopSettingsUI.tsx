import { Button, cn, IconButton } from "@/shared/ui";
import { CircleAlert, X } from "lucide-react";
import { createContext, type ReactNode } from "react";
import { useSettingReset } from "../devicePreferences/SettingScope";
import { type DesktopSettingsNavGroup, SettingsNavigation } from "./SettingsNavigation";
export type { DesktopSettingsNavEntry, DesktopSettingsNavGroup } from "./SettingsNavigation";
export const SettingsControlLabelContext = createContext<string | undefined>(undefined);
export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
  return (
    <div
      aria-label={props.ariaLabel}
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-[248px_1px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg",
        overlay ? "h-full" : "h-screen",
        "max-[900px]:grid-cols-[208px_1px_minmax(0,1fr)]",
        "max-[680px]:grid-cols-[168px_1px_minmax(0,1fr)]",
      )}
    >
      <aside className="flex min-h-0 flex-col overflow-hidden bg-charcoal-sidebar py-3 text-cream-muted">
        {props.navigationHeader ? (
          <div className="mb-3 shrink-0 px-3 max-[680px]:px-2">{props.navigationHeader}</div>
        ) : null}
        {props.navigationOverride ?? (
          <SettingsNavigation
            groups={props.groups}
            activeId={props.activeId}
            label={props.navigationLabel}
            onSelect={props.onSelect}
          />
        )}
        {props.navigationFooter ? (
          <div className="shrink-0 px-3 max-[680px]:px-2">{props.navigationFooter}</div>
        ) : null}
      </aside>

      <div aria-hidden="true" className="bg-charcoal-border" />

      <main className="relative flex min-h-0 min-w-0 flex-col bg-charcoal-bg">
        {/* No title bar: section headers carry the page, as the sidebar already names the area. */}
        <h1 className="sr-only">{props.title}</h1>
        {overlay ? (
          <IconButton
            label={`Close ${props.ariaLabel.toLowerCase()}`}
            className="absolute right-4 top-3 z-10"
            onClick={props.onClose}
          >
            <X className="size-4" strokeWidth={1.8} />
          </IconButton>
        ) : null}
        {/* The scrollbar floats inset from the panel edge, clear of the rounded corners. */}
        {/* In the overlay the scroller starts below the close button, so the scrollbar and the
            page never run under it; the page's top padding moves up to match. */}
        <div
          data-settings-scroller
          className={cn(
            "misty-scrollbar misty-scrollbar-floating mb-3 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain",
            overlay ? "mt-12" : "mt-3",
          )}
        >
          <div
            className={cn(
              "w-full max-w-[960px] px-10 pb-12 text-[15px] leading-6 max-[720px]:px-6",
              overlay ? "pt-0" : "pt-9",
            )}
          >
            {props.contentHeader}
            {props.children}
          </div>
        </div>
        {props.saveBar}
      </main>
    </div>
  );
}
/**
 * A group of rows under a plain header with an optional muted line of context. Spacing separates
 * rows; there are no cards or dividers.
 */
export function DesktopSettingsSection(props: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  density?: "normal" | "compact";
}) {
  return (
    <section
      aria-label={props.title}
      className={cn(
        "@container/settings min-w-0 last:mb-0",
        props.density === "compact" ? "mb-8" : "mb-10",
      )}
    >
      <div className={cn("min-w-0", props.density === "compact" ? "mb-1.5" : "mb-2")}>
        <h2
          className={cn(
            "font-semibold text-cream-bright",
            props.density === "compact" ? "text-base leading-6" : "text-[18px] leading-7",
          )}
        >
          {props.title}
        </h2>
        {props.description ? (
          <p className="mt-1 max-w-[680px] text-[15px] leading-6 text-cream-muted">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{props.children}</div>
    </section>
  );
}
/**
 * Label and optional description on the left, the control right-aligned so every page
 * shares one right edge. Reset appears after the description only while the value differs from
 * its default.
 */
export function DesktopSettingsRow(props: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  /** Unavailable right now; dims the text only. */
  muted?: boolean;
  /** Depends on the row above it and is drawn as its indented sub-row. */
  indent?: boolean;
  /** The control needs the full width (lists, text areas) and sits under the label. */
  stacked?: boolean;
  density?: "normal" | "compact";
}) {
  const reset = useSettingReset(props.label);
  return (
    <div
      data-setting-label={props.label}
      tabIndex={-1}
      aria-disabled={props.muted || undefined}
      className={cn(
        "group/setting-row grid items-center gap-y-3 outline-none",
        props.density === "compact" ? "min-h-14 gap-x-6 py-3" : "min-h-14 gap-x-8 py-3",
        "transition-colors duration-700 data-[setting-flash=true]:bg-charcoal-hover data-[setting-flash=true]:duration-0",
        props.stacked
          ? "grid-cols-1"
          : "grid-cols-[minmax(0,1fr)_auto] @max-[560px]/settings:grid-cols-1",
        props.indent && "pl-5",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <span
          className={cn(
            "text-[15px] font-medium leading-6",
            props.muted ? "text-cream-muted" : "text-cream-bright",
          )}
        >
          {props.label}
        </span>
        {props.description || reset ? (
          <p className="max-w-[720px] text-[14px] leading-[22px] text-cream-muted">
            {props.description}
            {reset ? (
              <>
                {props.description ? " " : null}
                <Button
                  type="button"
                  variant="link"
                  aria-label={`Reset ${props.label} to default`}
                  className={cn(
                    "inline h-auto border-0 p-0 align-baseline text-[14px] leading-[22px]",
                    "font-normal text-cream underline underline-offset-2 hover:text-cream-bright",
                  )}
                  onClick={reset}
                >
                  Reset
                </Button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <SettingsControlLabelContext.Provider value={props.label}>
        <div
          data-setting-control
          className={cn(
            "flex min-w-0 items-center gap-2",
            props.stacked ? "justify-start" : "justify-end @max-[560px]/settings:justify-start",
          )}
        >
          {props.children}
        </div>
      </SettingsControlLabelContext.Provider>
    </div>
  );
}
/** Inline status for a whole page, e.g. a save that failed. Monochrome; the icon carries the state. */
export function DesktopSettingsNotice(props: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-5 flex min-w-0 items-center gap-2.5 px-0 py-2 text-[14px] leading-5 text-cream"
    >
      <CircleAlert aria-hidden className="size-4 shrink-0 text-cream-muted" />
      <span className="min-w-0 flex-1">{props.children}</span>
      {props.action}
    </div>
  );
}
export interface DesktopSettingsFrameProps<Id extends string> {
  activeId: Id;
  ariaLabel: string;
  children: ReactNode;
  groups: readonly DesktopSettingsNavGroup<Id>[];
  navigationLabel: string;
  onClose?: () => void;
  /** Pinned to the content's bottom right, over the scrolling page. */
  saveBar?: ReactNode;
  onSelect: (id: Id) => void;
  presentation?: "page" | "overlay";
  /** Announced to screen readers; the sidebar already shows it. */
  title: ReactNode;
  navigationHeader?: ReactNode;
  /** Replaces the section list, e.g. with search results while the user types. */
  navigationOverride?: ReactNode;
  navigationFooter?: ReactNode;
  contentHeader?: ReactNode;
}
