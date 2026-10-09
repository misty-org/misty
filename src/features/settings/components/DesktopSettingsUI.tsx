import { Button, cn, IconButton } from "@/shared/ui";
import { CircleAlert, X } from "lucide-react";
import { createContext, type ReactNode } from "react";
import { useSettingReset } from "../profiles/SettingScope";
import { type DesktopSettingsNavEntry, SettingsNavigation } from "./SettingsNavigation";
export type { DesktopSettingsNavEntry } from "./SettingsNavigation";
export const SettingsControlLabelContext = createContext<string | undefined>(undefined);
export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
  return (
    <div
      aria-label={props.ariaLabel}
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-[216px_1px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg",
        overlay ? "h-full" : "h-screen",
        "max-[900px]:grid-cols-[184px_1px_minmax(0,1fr)]",
        "max-[680px]:grid-cols-[156px_1px_minmax(0,1fr)]",
      )}
    >
      <aside className="flex min-h-0 flex-col overflow-hidden bg-charcoal-sidebar py-3 text-cream-muted">
        {props.navigationHeader ? (
          <div className="mb-3 shrink-0 px-3 max-[680px]:px-2">{props.navigationHeader}</div>
        ) : null}
        {props.navigationOverride ?? (
          <SettingsNavigation
            items={props.items}
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

      <main className="flex min-h-0 min-w-0 flex-col bg-charcoal-bg">
        <header className="shrink-0 border-b border-charcoal-border">
          <div className="flex min-h-12 min-w-0 items-center gap-3 px-5 py-2 max-[720px]:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <h1 className="min-w-0 truncate text-base font-semibold leading-6 text-cream">
                {props.title}
              </h1>
              {props.titleAccessory}
            </div>
            {overlay ? (
              <IconButton label={`Close ${props.ariaLabel.toLowerCase()}`} onClick={props.onClose}>
                <X className="size-4" strokeWidth={1.8} />
              </IconButton>
            ) : null}
          </div>
        </header>
        {/* The scroller spans the full pane so its scrollbar sits at the panel edge. */}
        <div className="misty-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <div
            className={cn(
              "mx-auto w-full p-5 max-[720px]:p-4",
              overlay ? "max-w-[760px]" : "max-w-[860px]",
            )}
          >
            {props.contentHeader}
            {props.children}
          </div>
        </div>
      </main>
    </div>
  );
}
/** A group of rows under a small muted header. Rows draw their own hairlines; there is no card. */
export function DesktopSettingsSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={props.title} className="@container/settings mb-8 min-w-0 last:mb-0">
      <div className="mb-1.5 min-w-0">
        <h2 className="text-[13px] font-medium leading-5 text-cream-muted">{props.title}</h2>
        {props.description ? (
          <p className="mt-0.5 max-w-2xl text-[13px] leading-[18px] text-cream-muted">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{props.children}</div>
    </section>
  );
}
/**
 * Label and description on the left, the control in one fixed 240px column on the right so every
 * page lines up. Reset appears after the description only while the value differs from default.
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
}) {
  const reset = useSettingReset(props.label);
  return (
    <div
      data-setting-label={props.label}
      tabIndex={-1}
      aria-disabled={props.muted || undefined}
      className={cn(
        "group/setting-row grid min-h-14 items-center gap-x-6 gap-y-2.5 border-t border-charcoal-border py-3 outline-none",
        "transition-colors duration-700 data-[setting-flash=true]:bg-charcoal-hover data-[setting-flash=true]:duration-0",
        props.stacked
          ? "grid-cols-1"
          : "grid-cols-[minmax(0,1fr)_240px] @max-[560px]/settings:grid-cols-1",
        props.indent && "pl-5",
      )}
    >
      <div className="grid min-w-0 gap-0.5">
        <span
          className={cn(
            "text-sm font-medium leading-5",
            props.muted ? "text-cream-muted" : "text-cream",
          )}
        >
          {props.label}
        </span>
        {props.description || reset ? (
          <p className="text-[13px] leading-[18px] text-cream-muted">
            {props.description}
            {reset ? (
              <>
                {props.description ? " " : null}
                <Button
                  type="button"
                  variant="link"
                  aria-label={`Reset ${props.label} to default`}
                  className={cn(
                    "inline h-auto border-0 p-0 align-baseline text-[13px] leading-[18px]",
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
      className="mb-5 flex min-w-0 items-center gap-2.5 rounded-lg border border-charcoal-border px-3 py-2 text-[13px] leading-[18px] text-cream"
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
  items: readonly DesktopSettingsNavEntry<Id>[];
  navigationLabel: string;
  onClose?: () => void;
  onSelect: (id: Id) => void;
  presentation?: "page" | "overlay";
  title: ReactNode;
  /** Sits beside the title, e.g. the page's storage scope. */
  titleAccessory?: ReactNode;
  navigationHeader?: ReactNode;
  /** Replaces the section list, e.g. with search results while the user types. */
  navigationOverride?: ReactNode;
  navigationFooter?: ReactNode;
  contentHeader?: ReactNode;
}
