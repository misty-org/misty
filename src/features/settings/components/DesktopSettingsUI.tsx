import {
  RowGroupLabel,
  SettingsRow,
  SettingsSection,
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
} from "@misty/ui";
import { X } from "lucide-react";
import { Children, createContext, isValidElement, useContext, type ReactNode } from "react";
import { useSettingReset } from "../device-preferences/SettingScope";
import {
  type DesktopSettingsNavGroup,
  type DesktopSettingsPageSection,
  SettingsNavigation,
} from "./SettingsNavigation";
export const SettingsControlLabelContext = createContext<string | undefined>(undefined);
const SettingsPageTitleContext = createContext("");
export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
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
              "grid-cols-[--spacing(62)_1px_minmax(0,1fr)]",
              "max-[990px]:grid-cols-[--spacing(52)_1px_minmax(0,1fr)]",
              "max-[748px]:grid-cols-[--spacing(42)_1px_minmax(0,1fr)]",
            ]
          : "grid-cols-[minmax(0,1fr)]",
      )}
    >
      <WorkspaceSidebar
        hidden={!navigation}
        data-tour={props.navigationTour}
        className={cn(
          "w-auto gap-0 overflow-hidden border-r-0 p-0",
          props.navigationHeader ? "pt-1 pb-3" : "py-3",
        )}
      >
        <Text bare as="div" tone="muted" className="flex min-h-0 flex-1 flex-col">
          {props.navigationHeader ? (
            <div className="mb-2 flex h-(--ui-header) shrink-0 items-center px-3 *:w-full max-[748px]:px-2">
              {props.navigationHeader}
            </div>
          ) : null}
          {props.navigationOverride ?? (
            <SettingsNavigation
              groups={props.groups}
              activeId={props.activeId}
              label={props.navigationLabel}
              onSelect={props.onSelect}
              sections={props.sections}
              activeSection={props.activeSection}
              onSection={props.onSection}
            />
          )}
          {props.navigationFooter ? (
            <div className="shrink-0 px-3 max-[748px]:px-2">{props.navigationFooter}</div>
          ) : null}
        </Text>
      </WorkspaceSidebar>

      {navigation ? <Separator orientation="vertical" /> : null}

      <Surface as="main" tone="page" className="relative flex min-h-0 min-w-0 flex-col">
        {overlay ? (
          <Surface tone="sidebar" className="shrink-0">
            <TopBar
              divider
              start={
                props.title ? (
                  <Text
                    as="h1"
                    size="title"
                    weight="semibold"
                    tone="bright"
                    className="min-w-0 pl-3.5 max-[792px]:pl-1"
                  >
                    {props.title}
                  </Text>
                ) : undefined
              }
            >
              <IconButton label={`Close ${props.ariaLabel.toLowerCase()}`} onClick={props.onClose}>
                <X />
              </IconButton>
            </TopBar>
          </Surface>
        ) : null}
        <div
          data-settings-scroller
          className="misty-scrollbar misty-scrollbar-floating mb-3 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div
            className={cn(
              "w-full max-w-180 px-6 pb-12 max-[792px]:px-4",
              overlay ? "pt-4" : "pt-6",
            )}
          >
            {props.contentHeader}
            <SettingsPageTitleContext.Provider
              value={typeof props.title === "string" && overlay ? props.title : ""}
            >
              {props.children}
            </SettingsPageTitleContext.Provider>
          </div>
        </div>
        {props.saveBar}
        {props.corner !== undefined ? <BottomBar>{props.corner}</BottomBar> : null}
      </Surface>
    </Surface>
  );
}
export function DesktopSettingsSection(props: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  density?: "normal" | "compact";
}) {
  const repeatsPage = useContext(SettingsPageTitleContext) === props.title;
  if (props.density === "compact")
    return (
      <section aria-label={props.title} className="mb-5 grid min-w-0 gap-1.5 last:mb-0">
        {repeatsPage ? null : <RowGroupLabel title={props.title} />}
        {props.description ? (
          <Text as="p" size="meta" tone="muted" wrap className="px-0.5">
            {props.description}
          </Text>
        ) : null}
        <div className="min-w-0">{props.children}</div>
      </section>
    );
  return (
    <SettingsSection
      title={repeatsPage ? undefined : props.title}
      description={props.description}
      className="mb-5 last:mb-0"
    >
      {props.children}
    </SettingsSection>
  );
}
export function DesktopSettingsRow(props: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  muted?: boolean;
  indent?: boolean;
  stacked?: boolean;
  density?: "normal" | "compact";
  leading?: ReactNode;
}) {
  const reset = useSettingReset(props.label);
  const description =
    props.description || reset ? (
      <>
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
      </>
    ) : undefined;
  return (
    <SettingsRow
      label={props.label}
      description={description}
      leading={props.leading}
      sub={props.indent}
      disabled={props.muted}
      stacked={props.stacked}
      data-setting-label={props.label}
      tabIndex={-1}
      className="outline-none"
    >
      <SettingsControlLabelContext.Provider value={props.label}>
        <div data-setting-control className="flex min-w-0 items-center gap-2">
          {props.children}
        </div>
      </SettingsControlLabelContext.Provider>
    </SettingsRow>
  );
}
const settingsSkeletonWidths = ["w-32", "w-40", "w-28", "w-36"];

export function DesktopSettingsRowSkeleton(props: {
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
          data-setting-label=""
          role={index === 0 ? "status" : undefined}
          aria-label={index === 0 ? props.label : undefined}
          aria-busy={index === 0 || undefined}
          className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg py-1.5 pr-2 pl-3"
        >
          <div className="grid min-w-0 gap-1">
            <div className="flex h-5 items-center">
              <Skeleton
                className={cn(
                  "h-3.5",
                  settingsSkeletonWidths[index % settingsSkeletonWidths.length],
                )}
              />
            </div>
            {props.description ? (
              <div className="flex h-5 items-center">
                <Skeleton className="h-3 w-2/3" />
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

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function noticeAction(action: ReactNode): NoticeAction | undefined {
  const button = Children.toArray(action).find((child) =>
    isValidElement<{ children?: ReactNode; onClick?: () => void }>(child),
  );
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(button)) return undefined;
  const { children, onClick } = button.props;
  const label = textOf(children);
  return label && onClick ? { label, onSelect: () => onClick() } : undefined;
}

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
  saveBar?: ReactNode;
  corner?: ReactNode;
  navigationTour?: string;
  onSelect: (id: Id) => void;
  sections?: readonly DesktopSettingsPageSection[];
  activeSection?: string;
  onSection?: (id: string) => void;
  presentation?: "page" | "overlay";
  title: ReactNode;
  navigationHeader?: ReactNode;
  navigationOverride?: ReactNode;
  navigationFooter?: ReactNode;
  contentHeader?: ReactNode;
}
