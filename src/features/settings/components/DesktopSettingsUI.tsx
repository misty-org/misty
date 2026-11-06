import { Button, cn, IconButton, Notification } from "@/shared/ui";
import { X } from "lucide-react";
import { createContext, type ReactNode } from "react";
import { useSettingReset } from "../devicePreferences/SettingScope";
import { type DesktopSettingsNavGroup, SettingsNavigation } from "./SettingsNavigation";
;
export const SettingsControlLabelContext = createContext<string | undefined>(undefined);
export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
  // With no pages to list there is no sidebar: an empty column only reads as a missing nav.
  const navigation = Boolean(
    props.groups.length ||
    props.navigationHeader ||
    props.navigationOverride ||
    props.navigationFooter,
  );
  return (
    <div
      aria-label={props.ariaLabel}
      className={cn(
        "grid min-h-0 min-w-0 overflow-hidden bg-charcoal-bg",
        overlay ? "h-full" : "h-screen",
        navigation
          ? [
              "grid-cols-[248px_1px_minmax(0,1fr)]",
              "max-[900px]:grid-cols-[208px_1px_minmax(0,1fr)]",
              "max-[680px]:grid-cols-[168px_1px_minmax(0,1fr)]",
            ]
          : "grid-cols-[minmax(0,1fr)]",
      )}
    >
      <aside
        hidden={!navigation}
        className="flex min-h-0 flex-col overflow-hidden bg-charcoal-sidebar py-3 text-cream-muted"
      >
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

      {navigation ? <div aria-hidden="true" className="bg-charcoal-border" /> : null}

      <main className="relative flex min-h-0 min-w-0 flex-col bg-charcoal-bg">
        {/* The page we're on, over a divider; the page scrolls under it, never behind it. */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-charcoal-border pl-6 pr-4 max-[720px]:pl-4">
          <h1 className="min-w-0 truncate text-md font-semibold leading-6 text-cream-bright">
            {props.title}
          </h1>
          {overlay ? (
            <IconButton label={`Close ${props.ariaLabel.toLowerCase()}`} onClick={props.onClose}>
              <X className="size-4" strokeWidth={1.8} />
            </IconButton>
          ) : null}
        </header>
        {/* The scrollbar floats inset from the panel edge, clear of the rounded corners. */}
        <div
          data-settings-scroller
          className="misty-scrollbar misty-scrollbar-floating mb-3 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="w-full max-w-[960px] px-6 pb-12 pt-6 text-md leading-6 max-[720px]:px-4">
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
 * One panel: whatever a section holds gets the same inset and a hairline between items, and rows
 * wrapped in another element keep their hairlines too. The website's settings use the same panel.
 */
const settingsPanelClass = cn(
  "min-w-0 overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card empty:hidden",
  "[&>*]:px-5 [&>*:empty]:hidden [&>*:not([data-setting-label])]:py-3",
  "[&>*+*]:border-t [&>*+*]:border-charcoal-border",
  "[&_[data-setting-label]+[data-setting-label]]:border-t",
  "[&_[data-setting-label]+[data-setting-label]]:border-charcoal-border",
);
/**
 * A group of rows in one panel under a plain header, with an optional muted line of context. The
 * compact density, used inside the setup wizard, stays a plain list because the wizard is its own
 * card.
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
      className={cn("@container/settings min-w-0 last:mb-0", "mb-8")}
    >
      <div className={cn("min-w-0", props.density === "compact" ? "mb-1.5" : "mb-3")}>
        <h2
          className={cn(
            "font-semibold text-cream-bright",
            props.density === "compact" ? "text-base leading-6" : "text-md leading-6",
          )}
        >
          {props.title}
        </h2>
        {props.description ? (
          <p className="mt-1 max-w-[680px] text-md leading-6 text-cream-muted">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className={props.density === "compact" ? "min-w-0" : settingsPanelClass}>
        {props.children}
      </div>
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
        // The panel owns the row's own padding, so the indent goes on its contents.
        props.indent && "[&>:first-child]:pl-5",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <span
          className={cn(
            "text-md font-medium leading-6",
            props.muted ? "text-cream-muted" : "text-cream-bright",
          )}
        >
          {props.label}
        </span>
        {props.description || reset ? (
          <p className="max-w-[720px] text-sm leading-[22px] text-cream-muted">
            {props.description}
            {reset ? (
              <>
                {props.description ? " " : null}
                <Button
                  type="button"
                  variant="link"
                  aria-label={`Reset ${props.label} to default`}
                  className={cn(
                    "inline h-auto border-0 p-0 align-baseline text-sm leading-[22px]",
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
/** A failure for a whole page, e.g. a save that failed, shown as a notification. */
export function DesktopSettingsNotice(props: { children: ReactNode; action?: ReactNode }) {
  return (
    <Notification tone="error">
      {props.children}
      {props.action}
    </Notification>
  );
}
interface DesktopSettingsFrameProps<Id extends string> {
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
  /** The page we're on, in the header over the content. */
  title: ReactNode;
  navigationHeader?: ReactNode;
  /** Replaces the section list, e.g. with search results while the user types. */
  navigationOverride?: ReactNode;
  navigationFooter?: ReactNode;
  contentHeader?: ReactNode;
}
