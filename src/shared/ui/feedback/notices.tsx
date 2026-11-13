import { TriangleAlert, X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { cn } from "../classNames";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import { TooltipProvider } from "../overlays/Tooltip";

type NoticeTone = "neutral" | "error";

export type NoticeAction = { label: string; onSelect: () => void };

type NoticeOptions = {
  message: string;
  tone?: NoticeTone;
  /** At most one action, drawn as a small quiet button. Choosing it also dismisses the notice. */
  action?: NoticeAction;
  /** How long it stays, in ms: 5s, or 8s with an action. Hovering or focusing it pauses the clock. */
  duration?: number;
  /** Replaces a notice that is still up under the same id instead of stacking a second one. */
  id?: string;
  onDismiss?: () => void;
};

type NoticeHandle = { id: string; dismiss: () => void };

/** How many notices show at once; older timed ones give way to newer ones. */
const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 5_000;
const ACTION_DURATION = 8_000;

type NoticeRecord = {
  id: string;
  /** Changes when the notice should start its clock over: a new message under the same id. */
  revision: string;
  message: string;
  tone: NoticeTone;
  action?: NoticeAction;
  /** null stays until it is dismissed or its owner takes it down (useNotice). */
  duration: number | null;
  onDismiss?: () => void;
};

type Viewport = { fallback: boolean };

type NoticeStore = {
  notices: NoticeRecord[];
  listeners: Set<() => void>;
  viewports: Viewport[];
  fallbackHost: HTMLElement | null;
  nextId: number;
};

// The shell and component apps are separate bundles in one window; one store on the window
// keeps them to one stack.
const storeKey = Symbol.for("misty.notices");
type NoticeGlobal = typeof globalThis & { [storeKey]?: NoticeStore };

function store(): NoticeStore {
  const root = globalThis as NoticeGlobal;
  root[storeKey] ??= {
    notices: [],
    listeners: new Set(),
    viewports: [],
    fallbackHost: null,
    nextId: 0,
  };
  return root[storeKey];
}

function emit() {
  const state = store();
  state.listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  const { listeners } = store();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Drops the oldest timed notices that no longer fit; ones held by their owner wait their turn. */
function trim(notices: NoticeRecord[]) {
  const next = [...notices];
  while (next.length > MAX_VISIBLE) {
    const hidden = next.length - MAX_VISIBLE;
    const index = next.slice(0, hidden).findIndex((notice) => notice.duration !== null);
    if (index < 0) break;
    next.splice(index, 1);
  }
  return next;
}

function upsert(record: NoticeRecord) {
  const state = store();
  const at = state.notices.findIndex((notice) => notice.id === record.id);
  state.notices =
    at < 0
      ? trim([...state.notices, record])
      : state.notices.map((notice, index) => (index === at ? record : notice));
  ensureViewport();
  emit();
}

function remove(id: string, reason: "dismissed" | "withdrawn") {
  const state = store();
  const notice = state.notices.find((item) => item.id === id);
  if (!notice) return;
  state.notices = state.notices.filter((item) => item.id !== id);
  emit();
  if (reason === "dismissed") notice.onDismiss?.();
}

function newId() {
  const state = store();
  state.nextId += 1;
  return `notice-${state.nextId}`;
}

/**
 * Shows a notice at the bottom right. It leaves on its own after a few seconds (paused while the
 * pointer or focus is on it), carries at most one action, and can be dismissed with its ×.
 * Errors in a form belong next to the field (FieldError), not here.
 *
 * `notify({ message: "Chat moved to Archive", action: { label: "Undo", onSelect: restore } })`
 */
export function notify(options: NoticeOptions): NoticeHandle {
  const id = options.id ?? newId();
  upsert({
    id,
    revision: newId(),
    message: options.message,
    tone: options.tone ?? "neutral",
    action: options.action,
    duration: options.duration ?? (options.action ? ACTION_DURATION : DEFAULT_DURATION),
    onDismiss: options.onDismiss,
  });
  return { id, dismiss: () => remove(id, "dismissed") };
}

/**
 * A notice that stays while `show` holds and leaves when it clears, for conditions such as a
 * sign-in that is needed. Dismissing it hides it until `show` turns false and back, or the
 * message changes.
 *
 * `useNotice(needsSignIn, { message: "Sign in to Todoist to continue", action: { label: "Sign in", onSelect: signIn } })`
 */
export function useNotice(show: boolean, options: Omit<NoticeOptions, "duration" | "id">) {
  const id = React.useId();
  const [dismissedFor, setDismissedFor] = React.useState<string | null>(null);
  const latest = React.useRef(options);
  latest.current = options;
  const message = options.message;
  const visible = show && dismissedFor !== message;

  React.useEffect(() => {
    if (!show) setDismissedFor(null);
  }, [show]);

  const tone = options.tone ?? "neutral";
  const actionLabel = options.action?.label;
  React.useEffect(() => {
    if (!visible) return;
    upsert({
      id,
      revision: message,
      message,
      tone,
      action:
        actionLabel === undefined
          ? undefined
          : { label: actionLabel, onSelect: () => latest.current.action?.onSelect() },
      duration: null,
      onDismiss: () => {
        setDismissedFor(message);
        latest.current.onDismiss?.();
      },
    });
  }, [visible, id, message, tone, actionLabel]);

  React.useEffect(() => {
    if (!visible) return;
    return () => remove(id, "withdrawn");
  }, [id, visible]);
}

/** Mounts a viewport of its own when the app hasn't, so a notice is never lost. */
function ensureViewport() {
  const state = store();
  if (state.viewports.length || state.fallbackHost || typeof document === "undefined") return;
  const host = document.createElement("div");
  host.dataset.slot = "notice-fallback-host";
  document.body.append(host);
  state.fallbackHost = host;
  // Rendered after the current update, so a viewport mounting in the same pass wins.
  queueMicrotask(() => {
    const current = store();
    if (current.fallbackHost !== host) return;
    if (current.viewports.some((item) => !item.fallback)) {
      host.remove();
      current.fallbackHost = null;
      return;
    }
    createRoot(host).render(
      <TooltipProvider>
        <NoticeViewportInner fallback />
      </TooltipProvider>,
    );
  });
}

/**
 * Where notices show: once, at the app root. Newest at the bottom, at most three at a time.
 */
export function NoticeViewport() {
  return <NoticeViewportInner fallback={false} />;
}

function NoticeViewportInner({ fallback }: { fallback: boolean }) {
  const viewport = React.useRef<Viewport>({ fallback }).current;
  const [, rerender] = React.useReducer((count: number) => count + 1, 0);
  const notices = React.useSyncExternalStore(
    subscribe,
    () => store().notices,
    () => store().notices,
  );
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    const state = store();
    state.viewports.push(viewport);
    emit();
    const listener = () => rerender();
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
      state.viewports = state.viewports.filter((item) => item !== viewport);
      emit();
    };
  }, [viewport]);

  // The app's own viewport wins over the fallback; with several, the newest one shows.
  const viewports = store().viewports;
  const owned = viewports.filter((item) => !item.fallback);
  const active = owned.length ? owned[owned.length - 1] : viewports[0];
  if (active !== viewport || typeof document === "undefined") return null;
  const visible = notices.slice(-MAX_VISIBLE);
  if (!visible.length) return null;

  return createPortal(
    <section
      aria-label="Notifications"
      data-slot="notice-viewport"
      data-misty-window-drag-block="true"
      className={cn(
        "pointer-events-none fixed bottom-4 right-4 layer-notification flex w-90",
        "max-w-[calc(100vw-2rem)] flex-col gap-2",
      )}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      {visible.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} paused={paused} />
      ))}
    </section>,
    document.body,
  );
}

function NoticeCard({ notice, paused }: { notice: NoticeRecord; paused: boolean }) {
  const remaining = React.useRef(notice.duration);
  React.useEffect(() => {
    remaining.current = notice.duration;
  }, [notice.duration, notice.revision]);

  React.useEffect(() => {
    if (paused || remaining.current === null) return;
    const started = Date.now();
    const timer = window.setTimeout(
      () => remove(notice.id, "dismissed"),
      Math.max(0, remaining.current),
    );
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) remaining.current -= Date.now() - started;
    };
  }, [paused, notice.id, notice.duration, notice.revision]);

  const error = notice.tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      aria-atomic="true"
      data-slot="notice"
      data-misty-notification="true"
      data-tone={notice.tone}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-lg border border-charcoal-border",
        "bg-charcoal-card py-2 pl-3 pr-2 text-body text-cream",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-150",
      )}
    >
      {error ? (
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      ) : null}
      <div className="min-w-0 flex-1 py-px [overflow-wrap:anywhere]">{notice.message}</div>
      {notice.action ? (
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="shrink-0"
          onClick={() => {
            notice.action?.onSelect();
            remove(notice.id, "dismissed");
          }}
        >
          {notice.action.label}
        </Button>
      ) : null}
      <IconButton
        label="Dismiss"
        variant="quiet"
        size="sm"
        className="shrink-0"
        onClick={() => remove(notice.id, "dismissed")}
      >
        <X />
      </IconButton>
    </div>
  );
}

/** @internal For tests: clears every notice and the fallback viewport. */
export function resetNotices() {
  const state = store();
  state.notices = [];
  state.fallbackHost?.remove();
  state.fallbackHost = null;
  emit();
}
