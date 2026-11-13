import {
  BottomBar,
  cn,
  IconButton,
  InlineLink,
  Separator,
  Skeleton,
  SkeletonControl,
  Surface,
  Text,
  TopBar,
  trailingControls,
  type NoticeAction,
  type SkeletonTrailing,
  useNotice,
  WorkspaceSidebar,
} from "@/shared/ui";
import { X } from "lucide-react";
import { Children, createContext, isValidElement, type ReactNode } from "react";
import { useSettingReset } from "../device-preferences/SettingScope";
import { type DesktopSettingsNavGroup, SettingsNavigation } from "./SettingsNavigation";
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
    <Surface
      aria-label={props.ariaLabel}
      tone="page"
      className={cn(
        "grid min-h-0 min-w-0 overflow-hidden",
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
      {/* The grid sets the column's width and the separator column draws its edge. */}
      <WorkspaceSidebar
        hidden={!navigation}
        data-tour={props.navigationTour}
        className="w-auto gap-0 overflow-hidden border-r-0 p-0 py-3"
      >
        <Text bare as="div" tone="muted" className="flex min-h-0 flex-1 flex-col">
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
        </Text>
      </WorkspaceSidebar>

      {navigation ? <Separator orientation="vertical" /> : null}

      <Surface as="main" tone="page" className="relative flex min-h-0 min-w-0 flex-col">
        {/* No title: the navigation names the page. An overlay's close button has a bar of its
            own along the top, on the page's color, and the page scrolls beneath it. */}
        {overlay ? (
          <TopBar>
            <IconButton label={`Close ${props.ariaLabel.toLowerCase()}`} onClick={props.onClose}>
              <X />
            </IconButton>
          </TopBar>
        ) : null}
        {/* The scrollbar floats inset from the panel edge, clear of the rounded corners. */}
        <div
          data-settings-scroller
          className="misty-scrollbar misty-scrollbar-floating mb-3 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div
            className={cn(
              "w-full max-w-240 px-6 pb-12 text-md leading-6 max-[720px]:px-4",
              // Under an overlay's top bar the page starts closer; the bar already gives it room.
              overlay ? "pt-2" : "pt-6",
            )}
          >
            {props.contentHeader}
            {props.children}
          </div>
        </div>
        {props.saveBar}
        {/* The bar keeps its room while the save bar hides the "i", so the page doesn't jump. */}
        {props.corner !== undefined ? <BottomBar>{props.corner}</BottomBar> : null}
      </Surface>
    </Surface>
  );
}
/**
 * One panel: whatever a section holds gets the same inset and a hairline between items, and rows
 * wrapped in another element keep their hairlines too. The website's settings use the same panel.
 */
const settingsPanelClass = cn(
  "min-w-0 overflow-hidden empty:hidden",
  "[&>*]:px-5 [&>*:empty]:hidden [&>*:not([data-setting-label])]:py-3",
  // Bare edges take the theme's hairline.
  "[&>*+*]:border-t",
  "[&_[data-setting-label]+[data-setting-label]]:border-t",
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
        <Text
          bare
          as="h2"
          tone="bright"
          weight="semibold"
          className={props.density === "compact" ? "text-base leading-6" : "text-md leading-6"}
        >
          {props.title}
        </Text>
        {props.description ? (
          <Text bare as="p" tone="muted" className="mt-1 max-w-170 text-md leading-6">
            {props.description}
          </Text>
        ) : null}
      </div>
      {props.density === "compact" ? (
        <div className="min-w-0">{props.children}</div>
      ) : (
        <Surface tone="card" edge="hairline" radius="lg" className={settingsPanelClass}>
          {props.children}
        </Surface>
      )}
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
  /** A picture before the label, such as the feature a page sets up (Tutor's sprite). */
  leading?: ReactNode;
}) {
  const reset = useSettingReset(props.label);
  return (
    <Surface
      tone="none"
      data-setting-label={props.label}
      tabIndex={-1}
      aria-disabled={props.muted || undefined}
      className={cn(
        "group/setting-row grid items-center gap-y-3 outline-none",
        props.density === "compact" ? "min-h-14 gap-x-6 py-3" : "min-h-14 gap-x-8 py-3",
        "transition-colors duration-700 data-[flash=true]:duration-0",
        props.stacked
          ? "grid-cols-1"
          : "grid-cols-[minmax(0,1fr)_auto] @max-[560px]/settings:grid-cols-1",
        // The panel owns the row's own padding, so the indent goes on its contents.
        props.indent && "[&>:first-child]:pl-5",
      )}
    >
      <div className={cn("flex min-w-0 items-center", props.leading ? "gap-4" : null)}>
        {props.leading}
        <div className="grid min-w-0 gap-1">
          <Text
            bare
            tone={props.muted ? "muted" : "bright"}
            weight="medium"
            className="text-md leading-6"
          >
            {props.label}
          </Text>
          {props.description || reset ? (
            <Text bare as="p" tone="muted" className="max-w-180 text-sm leading-6">
              {props.description}
              {reset ? (
                <>
                  {props.description ? " " : null}
                  <Text bare tone="default">
                    <InlineLink aria-label={`Reset ${props.label} to default`} onClick={reset}>
                      Reset
                    </InlineLink>
                  </Text>
                </>
              ) : null}
            </Text>
          ) : null}
        </div>
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
    </Surface>
  );
}
const settingsSkeletonWidths = ["w-32", "w-40", "w-28", "w-36"];

/**
 * Placeholder settings rows for a section's first load, with DesktopSettingsRow's own grid,
 * padding and hairlines, a label (and a description line when the real rows have one), and the
 * row's real control at the right. Render it where the rows go, inside the section.
 */
export function DesktopSettingsRowSkeleton(props: {
  /** What is loading, for screen readers. */
  label: string;
  rows?: number;
  description?: boolean;
  control?: SkeletonTrailing;
  density?: "normal" | "compact";
}) {
  const ends = trailingControls(props.control);
  return (
    <>
      {Array.from({ length: props.rows ?? 1 }, (_, index) => (
        <div
          key={index}
          // An empty label keeps the panel's padding and hairlines without naming a setting.
          data-setting-label=""
          role={index === 0 ? "status" : undefined}
          aria-label={index === 0 ? props.label : undefined}
          aria-busy={index === 0 || undefined}
          className={cn(
            "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center py-3",
            props.density === "compact" ? "gap-x-6" : "gap-x-8",
          )}
        >
          <div className="grid min-w-0 gap-1">
            <div className="flex h-6 items-center">
              <Skeleton
                className={cn("h-4", settingsSkeletonWidths[index % settingsSkeletonWidths.length])}
              />
            </div>
            {props.description ? (
              <div className="flex h-6 items-center">
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            {ends.map((control, end) => (
              <SkeletonControl key={end} kind={control.kind} className={control.className} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** The words of a node, for a notice, which is one line of text. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A notice's one action, read from the button a page hands over: its label and its click. */
function noticeAction(action: ReactNode): NoticeAction | undefined {
  const button = Children.toArray(action).find((child) =>
    isValidElement<{ children?: ReactNode; onClick?: () => void }>(child),
  );
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(button)) return undefined;
  const { children, onClick } = button.props;
  const label = textOf(children);
  return label && onClick ? { label, onSelect: () => onClick() } : undefined;
}

/** A failure for a whole page, e.g. a save that failed, shown as a notice in the corner. */
export function DesktopSettingsNotice(props: { children: ReactNode; action?: ReactNode }) {
  const message = textOf(props.children).trim();
  useNotice(Boolean(message), { message, tone: "error", action: noticeAction(props.action) });
  return null;
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
  /**
   * The end of the content's bottom bar, such as the popup's tour button. Null keeps the bar
   * (and its room) with nothing in it; leave it out for no bar.
   */
  corner?: ReactNode;
  /** The `data-tour` name of the navigation column, for a tour to point at. */
  navigationTour?: string;
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
