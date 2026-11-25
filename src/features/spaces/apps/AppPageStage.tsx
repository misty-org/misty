import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  LivePointer,
  notify,
  PageStage,
  Pressable,
  SetupState,
} from "@misty/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  browserRuntimeResumeEvent,
  isBrowserLayoutMoving,
  onBrowserSettled,
  type BrowserBounds,
} from "@/features/app-windows";
import { personTone } from "@/features/agents";
import { usePresentedPageHost, visibleBrowserBounds } from "@/features/browser";
import { invoke } from "@/native";
import { appZoomChangedEvent } from "@/shared/hooks/use_app_zoom";
import { useAppControl } from "./app_screen";
import type { FrameTarget } from "./host_channel";
import { createAppPageLink } from "./native_app_link";
import type { AppPageView, SavedDownload } from "./use_running_app";

const newMount = (appId: string) =>
  `${appId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;

function hostShown(host: HTMLElement): boolean {
  if (host.closest("[data-tab-kept], [hidden]")) return false;
  return (
    typeof host.checkVisibility !== "function" || host.checkVisibility({ visibilityProperty: true })
  );
}

const sameBounds = (a: BrowserBounds, b: BrowserBounds) =>
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height &&
  a.cornerColor === b.cornerColor &&
  (a.cornerRadii ?? []).join(":") === (b.cornerRadii ?? []).join(":");

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

interface Question {
  id: string;
  kinds: string[];
}

const REFUSAL_NOTICES = 3;

function outsideAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function asked(kinds: string[]): string {
  const names = kinds.map((kind) =>
    kind === "camera" ? "camera" : kind === "microphone" ? "microphone" : "location",
  );
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
}

export function AppPageStage({
  spaceId,
  appId,
  version,
  appName,
  site = false,
  instance,
  start,
  leave,
  save,
  onChannel,
}: {
  spaceId: string;
  appId: string;
  version: string;
  appName: string;
  site?: boolean;
  instance: string;
  start: (frame: FrameTarget, element: HTMLElement, page: AppPageView) => void;
  leave: () => void;
  save: (file: SavedDownload) => Promise<void>;
  onChannel?: (channel: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState(() => newMount(appId));
  const [opened, setOpened] = useState(false);
  const [presented, setPresented] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const answered = useRef(new Set<string>());
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const saveRef = useRef(save);
  saveRef.current = save;
  const channelRef = useRef(onChannel);
  channelRef.current = onChannel;
  const nameRef = useRef(appName);
  nameRef.current = appName;
  const agent = useAppControl((state) => state.agents[instance]);
  const held = useAppControl((state) => Boolean(state.held[instance]));
  const lowered = Boolean(agent && !held);
  usePresentedPageHost(`app-page:${mount}`, presented);

  useEffect(() => {
    const link = createAppPageLink(mount, { world: site });
    const page: AppPageView = {
      snapshot: () =>
        invoke<{ dataUrl: string; width: number; height: number }>("space_app_page_snapshot", {
          request: { mount },
        }),
    };
    const stopReady = link.onReady(() => {
      if (host.current) startRef.current(link.frame, host.current, page);
    });
    const stopLeft = link.onLeft(() => leaveRef.current());
    const refused = new Set<string>();
    const stopEvents = link.onPageEvent((kind, body) => {
      if (!isRecord(body)) return;
      if (kind === "navigation-refused") {
        const address = outsideAddress(body.url);
        const place = typeof body.host === "string" && body.host ? body.host : null;
        if (!address || !place || refused.has(place) || refused.size >= REFUSAL_NOTICES) return;
        refused.add(place);
        notify({
          message: `${nameRef.current} tried to open ${place}.`,
          action: {
            label: "Open",
            onSelect: () =>
              void openUrl(address).catch((error: unknown) =>
                notify({ message: `${place} didn't open: ${messageOf(error)}`, tone: "error" }),
              ),
          },
        });
        return;
      }
      if (kind === "permission" && typeof body.id === "string" && Array.isArray(body.kinds)) {
        const question = { id: body.id, kinds: body.kinds.map(String) };
        setQuestions((waiting) => [...waiting, question]);
        return;
      }
      if (
        kind === "download" &&
        typeof body.reference === "string" &&
        typeof body.name === "string"
      ) {
        const name = body.name;
        const mime = typeof body.mime === "string" ? body.mime : "application/octet-stream";
        void link
          .takeBytes(body.reference)
          .then((data) => saveRef.current({ name, mime, data }))
          .catch((error: unknown) =>
            notify({
              message: `${name} wasn't saved to Files: ${messageOf(error)}`,
              tone: "error",
            }),
          );
        return;
      }
      if (kind === "download-failed" && typeof body.message === "string")
        notify({ message: body.message, tone: "error" });
    });
    return () => {
      stopReady();
      stopLeft();
      stopEvents();
      link.dispose();
      setQuestions([]);
      void invoke("space_app_page_close", { request: { mount } }).catch(() => undefined);
    };
  }, [mount, site]);

  useEffect(() => {
    if (!opened) return;
    void invoke("space_app_page_lower", { request: { mount, lowered } }).catch(() => undefined);
  }, [mount, opened, lowered]);

  useLayoutEffect(() => {
    let disposed = false;
    let frame = 0;
    let phase: "closed" | "shown" | "hidden" = "closed";
    let sent: BrowserBounds | null = null;
    let wanted: BrowserBounds | null | undefined;
    let queue = Promise.resolve();

    const apply = async () => {
      const bounds = wanted;
      wanted = undefined;
      if (bounds === undefined || disposed) return;
      if (!bounds) {
        if (phase !== "shown") return;
        phase = "hidden";
        setPresented(false);
        await invoke("space_app_page_hide", { request: { mount } });
        return;
      }
      if (phase === "shown" && sent && sameBounds(sent, bounds)) return;
      if (phase === "closed") {
        const result = await invoke<{ channel: boolean }>("space_app_page_open", {
          request: { mount, appId, version, spaceId, ...bounds },
        });
        if (disposed) {
          await invoke("space_app_page_close", { request: { mount } }).catch(() => undefined);
          return;
        }
        channelRef.current?.(result.channel);
        setOpened(true);
      } else {
        const exists = await invoke<boolean>("space_app_page_place", {
          request: { mount, ...bounds },
        });
        if (!exists) throw new Error(`${appName} closed.`);
      }
      sent = bounds;
      phase = "shown";
      if (!disposed) setPresented(true);
    };
    const synchronize = () => {
      frame = 0;
      if (disposed || isBrowserLayoutMoving()) return;
      const element = host.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        setSize((last) =>
          last && last.width === rect.width && last.height === rect.height
            ? last
            : { width: rect.width, height: rect.height },
        );
      }
      wanted = element && hostShown(element) ? visibleBrowserBounds(element) : null;
      queue = queue.then(apply).catch((error: unknown) => {
        if (!disposed) setFailed(messageOf(error));
      });
    };
    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(synchronize);
    };
    const element = host.current;
    const resize = new ResizeObserver(schedule);
    if (element) resize.observe(element);
    const hidden = new MutationObserver(schedule);
    hidden.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "inert", "hidden", "data-tab-kept"],
    });
    const scrolled = (event: Event) => {
      if (!host.current || (event.target instanceof Node && event.target.contains(host.current)))
        schedule();
    };
    const stopSettled = onBrowserSettled(schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener(browserRuntimeResumeEvent, schedule);
    window.addEventListener(appZoomChangedEvent, schedule);
    window.addEventListener("misty:workspace-geometry-changed", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    const settling = [50, 200, 600].map((delay) => window.setTimeout(schedule, delay));
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      settling.forEach((timer) => window.clearTimeout(timer));
      resize.disconnect();
      hidden.disconnect();
      stopSettled();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener(browserRuntimeResumeEvent, schedule);
      window.removeEventListener(appZoomChangedEvent, schedule);
      window.removeEventListener("misty:workspace-geometry-changed", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [mount, spaceId, appId, version, appName]);

  const question = questions[0];
  const answer = (allow: boolean) => {
    if (!question || answered.current.has(question.id)) return;
    answered.current.add(question.id);
    setQuestions((waiting) => waiting.slice(1));
    void invoke("space_app_page_permission_answer", { mount, id: question.id, allow }).catch(
      (error: unknown) => notify({ message: messageOf(error), tone: "error" }),
    );
  };

  if (failed)
    return (
      <SetupState
        tool={appName}
        error={failed}
        onRetry={() => {
          setFailed(null);
          setOpened(false);
          setPresented(false);
          setMount(newMount(appId));
        }}
      />
    );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PageStage hostRef={host} placed={opened} presented={presented}>
        <SetupState tool={appName} label={`Setting up ${appName}`} stallAfterMs={false} />
      </PageStage>
      {lowered && presented ? (
        <Pressable
          aria-label={`Take control of ${appName}`}
          className="absolute inset-0"
          onPointerDown={() => useAppControl.getState().takeBack(instance)}
        />
      ) : null}
      {agent && size && presented ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <LivePointer
            name={agent.name}
            tone={personTone(agent.agentId)}
            left={agent.x * size.width}
            top={agent.y * size.height}
          />
        </div>
      ) : null}
      <AlertDialog open={Boolean(question)} onOpenChange={(open) => !open && answer(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {question ? `Let ${appName} use your ${asked(question.kinds)}?` : ""}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => answer(false)}>Don&apos;t allow</AlertDialogCancel>
            <AlertDialogAction onClick={() => answer(true)}>Allow</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
