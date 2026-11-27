import {
  SettingsRow,
  SettingsSection,
  BottomBar,
  cn,
  FramedBar,
  FramedPage,
  IconButton,
  InlineLink,
  Portal,
  Skeleton,
  SkeletonControl,
  Text,
  trailingControls,
  type NoticeAction,
  type SectionHeadingAction,
  type SkeletonTrailing,
  useNotice,
} from "@misty/ui";
import { X } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useSettingReset } from "../device-preferences/SettingScope";
import { type DesktopSettingsNavGroup, SettingsNavigation } from "./SettingsNavigation";
export const SettingsControlLabelContext = createContext<string | undefined>(undefined);
const SettingsBarSlotContext = createContext<HTMLElement | null | undefined>(undefined);
const SectionActionContext = createContext<((action?: SectionHeadingAction) => void) | null>(null);
export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  const navigation = Boolean(
    props.groups.length ||
    props.navigationHeader ||
    props.navigationOverride ||
    props.navigationFooter,
  );
  const rail = (
    <Text
      bare
      as="div"
      tone="muted"
      data-tour={props.navigationTour}
      className="flex min-h-0 flex-1 flex-col pt-1.5 pb-3"
    >
      {props.navigationOverride ?? (
        <SettingsNavigation
          groups={props.groups}
          activeId={props.activeId}
          label={props.navigationLabel}
          onSelect={props.onSelect}
        />
      )}
      {props.navigationFooter ? (
        <div className="shrink-0 px-3">{props.navigationFooter}</div>
      ) : null}
    </Text>
  );
  return (
    <FramedPage
      autoSaveId="settings"
      workMinWidth={240}
      className={overlay ? undefined : "h-screen"}
      header={
        overlay ? (
          <FramedBar
            start={
              props.title ? (
                <div className="flex min-w-0 items-center gap-1">
                  {props.back}
                  <Text
                    as="h1"
                    size="title"
                    weight="semibold"
                    tone="bright"
                    className={cn("min-w-0", !props.back && "pl-3.5")}
                  >
                    {props.title}
                  </Text>
                </div>
              ) : undefined
            }
          >
            <div ref={setBarSlot} className="flex min-w-0 items-center gap-2 empty:hidden" />
            {props.actions}
            <IconButton label={`Close ${props.ariaLabel.toLowerCase()}`} onClick={props.onClose}>
              <X />
            </IconButton>
          </FramedBar>
        ) : null
      }
      start={
        navigation
          ? {
              id: "sections",
              content: rail,
              label: `Resize ${props.navigationLabel.toLowerCase()}`,
              width: 248,
              minWidth: 200,
              maxWidth: 320,
              keep: true,
              headerLine: false,
              header: props.navigationHeader ? (
                <FramedBar
                  start={
                    <div className="flex min-w-0 flex-1 *:w-full">{props.navigationHeader}</div>
                  }
                />
              ) : undefined,
            }
          : null
      }
    >
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          data-settings-scroller
          className="misty-scrollbar misty-scrollbar-floating mb-3 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className={cn("w-full px-6 pb-12", overlay ? "pt-4" : "pt-6")}>
            {props.contentHeader}
            <SettingsBarSlotContext.Provider value={overlay ? barSlot : undefined}>
              {props.children}
            </SettingsBarSlotContext.Provider>
          </div>
        </div>
        {props.saveBar}
        {props.corner !== undefined ? <BottomBar>{props.corner}</BottomBar> : null}
      </main>
    </FramedPage>
  );
}

/**
 * Controls that belong to the open settings page as a whole (Shortcuts' search and Restore all),
 * drawn in the page's top bar beside its close button.
 */
export function SettingsPageBar(props: { children: ReactNode }) {
  const slot = useContext(SettingsBarSlotContext);
  if (slot) return <Portal container={slot}>{props.children}</Portal>;
  if (slot === null) return null;
  return <div className="flex min-w-0 items-center justify-end gap-2">{props.children}</div>;
}

const sectionSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function DesktopSettingsSection(
  props: Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
    title: string;
    description?: ReactNode;
    action?: SectionHeadingAction;
    children: ReactNode;
    section?: string;
  },
) {
  const { title, description, action, children, section, ...rest } = props;
  return (
    <SettingsSection
      {...rest}
      title={title}
      description={description}
      action={action}
      data-settings-section={section ?? sectionSlug(title)}
      data-settings-title={title}
      className="scroll-mt-4"
    >
      {children}
    </SettingsSection>
  );
}

/**
 * A section of a settings page whose heading the page draws from its registry entry, holding
 * rows only. A row component sets the heading's one action with `useSettingsSectionAction`.
 */
export function TitledSettingsSection(
  props: Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
    title: string;
    section: string;
    children: ReactNode;
  },
) {
  const [action, setAction] = useState<SectionHeadingAction>();
  return (
    <SectionActionContext.Provider value={setAction}>
      <DesktopSettingsSection {...props} action={action} />
    </SectionActionContext.Provider>
  );
}

export function useSettingsSectionAction(action: SectionHeadingAction | undefined) {
  const set = useContext(SectionActionContext);
  const latest = useRef(action);
  useLayoutEffect(() => {
    latest.current = action;
  });
  const shown = action ? `${action.label}\n${action.disabled ? "off" : "on"}` : "";
  useEffect(() => {
    const current = latest.current;
    if (!set || !shown || !current) return;
    set({
      label: current.label,
      icon: current.icon,
      showLabel: current.showLabel,
      disabled: current.disabled,
      onSelect: () => latest.current?.onSelect?.(),
    });
    return () => set(undefined);
  }, [set, shown]);
}

export function DesktopSettingsRow(props: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  muted?: boolean;
  indent?: boolean;
  stacked?: boolean;
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
  presentation?: "page" | "overlay";
  title: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
  navigationHeader?: ReactNode;
  navigationOverride?: ReactNode;
  navigationFooter?: ReactNode;
  contentHeader?: ReactNode;
}
