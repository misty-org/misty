import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { decodeNativeAppValue, encodeNativeAppValue } from "./nativeAppWire";
import { isNativeDeviceMethod, useNativeAppPermissions } from "./useNativeAppPermissions";
import { Button } from "@/shared/ui";
import {
  requestEmbeddedBrowserSuspension,
  subscribeEmbeddedBrowserSuspension,
} from "@/shared/platform/browserSuspensionSignal";

interface RpcEvent {
  instance: string;
  requestId: string;
  message: unknown;
}
export interface NativeAppViewProps {
  source: string;
  title: string;
  active?: boolean;
  context: unknown;
  onRequest: (message: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  scopeLimit?: string[];
  expiresAt?: string;
  owner?: { accountId: string; spaceId?: string };
}

/** Mount under an account/App/Space/grant key so identity changes close the view. */
export function NativeAppView(props: NativeAppViewProps) {
  const element = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [instance, setInstance] = useState("");
  const expireCurrent = useRef<() => void>(() => undefined);
  const native = hasTauriInternals() && !isNativeMobileBuild;
  const permissions = useNativeAppPermissions(props.title);
  const permissionActions = useRef(permissions);
  permissionActions.current = permissions;
  const [suspended, setSuspended] = useState(false);
  const suspensionReason = useRef(`app-permissions:${crypto.randomUUID()}`);
  useEffect(() => {
    const reasons = new Set<string>();
    return subscribeEmbeddedBrowserSuspension((active, reason) => {
      if (active) reasons.add(reason);
      else reasons.delete(reason);
      setSuspended(reasons.size > 0);
    });
  }, []);
  useEffect(() => {
    const reason = suspensionReason.current;
    requestEmbeddedBrowserSuspension(permissions.active, reason);
    return () => requestEmbeddedBrowserSuspension(false, reason);
  }, [permissions.active]);
  const ownerKey = JSON.stringify([props.owner?.accountId ?? null, props.owner?.spaceId ?? null]);
  const scopeKey = JSON.stringify(props.scopeLimit?.slice().sort() ?? null);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let label = "";
    let unlisten: (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;
    const requests = new Map<string, AbortController>();
    expireCurrent.current = () => {
      disposed = true;
      window.clearTimeout(timer);
      requests.forEach((request) => request.abort());
      requests.clear();
      permissionActions.current.reset();
      if (label) void invoke("mini_app_close", { instance: label }).catch(() => undefined);
    };
    const queued: RpcEvent[] = [];
    setError("");
    setReady(false);
    setInstance("");
    const timer = window.setTimeout(
      () => setError(`${current.current.title} took too long to start.`),
      20_000,
    );
    const receive = async (event: RpcEvent) => {
      if (disposed) return;
      if (!label) {
        if (queued.length < 128) queued.push(event);
        return;
      }
      if (event.instance !== label) return;
      const abort = new AbortController();
      requests.set(event.requestId, abort);
      let result: unknown;
      let failure: string | undefined;
      try {
        const message = decodeNativeAppValue(event.message);
        if (!message || typeof message !== "object" || Array.isArray(message))
          throw new Error("Invalid App request.");
        const input = message as Record<string, unknown>;
        if (
          input.type === "misty:app-ready" ||
          input.method === "lifecycle.ready" ||
          (input.channel === "misty-plugin" && input.kind === "ready")
        ) {
          window.clearTimeout(timer);
          setReady(true);
          setError("");
        } else if (input.type === "misty:app-error") {
          const message =
            typeof input.message === "string" ? input.message.slice(0, 500) : "App startup failed.";
          window.clearTimeout(timer);
          setReady(false);
          setError(message);
          throw new Error(message);
        } else if (input.method === "context.get" && current.current.scopeLimit == null) {
          result = await invoke("mini_app_context", { instance: label });
        } else if (isNativeDeviceMethod(input.method)) {
          const assertAuthorized = () => {
            const expiry = current.current.expiresAt;
            if (
              disposed ||
              abort.signal.aborted ||
              (expiry != null &&
                (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now()))
            )
              throw new Error("The App session has expired or closed.");
          };
          assertAuthorized();
          result = await permissionActions.current.execute(
            label,
            input.method,
            input.params,
            assertAuthorized,
            abort.signal,
          );
          assertAuthorized();
        } else result = await current.current.onRequest(input, abort.signal);
      } catch (caught) {
        failure =
          caught instanceof Error
            ? caught.message
            : typeof caught === "string"
              ? caught.slice(0, 500)
              : "App request failed.";
      }
      requests.delete(event.requestId);
      if (!disposed && !abort.signal.aborted)
        await invoke("mini_app_reply", {
          instance: label,
          requestId: event.requestId,
          result: encodeNativeAppValue(result),
          error: failure ?? null,
        }).catch(() => undefined);
    };
    void (async () => {
      unlisten = await listen<RpcEvent>(
        "misty:mini-app-request",
        (event) => {
          void receive(event.payload);
        },
        { target: { kind: "Webview", label: "main" } },
      );
      if (disposed) {
        unlisten();
        return;
      }
      unlistenCancelled = await listen<Omit<RpcEvent, "message">>(
        "misty:mini-app-request-cancelled",
        ({ payload }) => {
          if (payload.instance === label) requests.get(payload.requestId)?.abort();
        },
        { target: { kind: "Webview", label: "main" } },
      );
      if (disposed) {
        unlistenCancelled();
        return;
      }
      label = await invoke<string>("mini_app_open", {
        request: {
          source: props.source,
          owner: current.current.owner ?? null,
          scopeLimit: current.current.scopeLimit ?? null,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
        },
      });
      if (disposed) {
        await invoke("mini_app_close", { instance: label });
        return;
      }
      setInstance(label);
      for (const event of queued.splice(0)) void receive(event);
    })().catch((caught) => {
      if (!disposed) {
        window.clearTimeout(timer);
        setError(String(caught));
      }
    });
    return () => {
      disposed = true;
      requests.forEach((request) => request.abort());
      requests.clear();
      permissionActions.current.reset();
      window.clearTimeout(timer);
      unlisten?.();
      unlistenCancelled?.();
      if (label) void invoke("mini_app_close", { instance: label }).catch(() => undefined);
    };
  }, [attempt, native, props.source, scopeKey, ownerKey]);

  useEffect(() => {
    if (!instance || props.expiresAt == null) return;
    let timer = 0;
    const check = () => {
      const remaining = Date.parse(props.expiresAt!) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        expireCurrent.current();
        setReady(false);
        setError("The App session has expired. Reopen the App to continue.");
      } else timer = window.setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    return () => window.clearTimeout(timer);
  }, [instance, props.expiresAt]);

  useEffect(() => {
    if (!instance || !ready) return;
    void invoke("mini_app_post", { instance, message: encodeNativeAppValue(props.context) }).catch(
      (caught) => setError(String(caught)),
    );
  }, [instance, props.context, ready]);

  useEffect(() => {
    if (!instance || !element.current) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.current?.getBoundingClientRect();
        if (!rect) return;
        const visible =
          ready &&
          !permissions.active &&
          !suspended &&
          !error &&
          props.active !== false &&
          rect.width > 0 &&
          rect.height > 0 &&
          !document.hidden &&
          !document.documentElement.hasAttribute("data-browser-overlay-active");
        void invoke("mini_app_layout", {
          instance,
          visible,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          bounds: {
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
          },
        }).catch(() => undefined);
      });
    };
    const sizeObserver = new ResizeObserver(update);
    sizeObserver.observe(element.current);
    const overlayObserver = new MutationObserver(update);
    overlayObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-browser-overlay-active"],
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      overlayObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("visibilitychange", update);
    };
  }, [error, instance, props.active, ready, permissions.active, suspended]);

  return (
    <div
      className="relative flex h-full min-h-[240px] w-full flex-col"
      data-misty-native-app={props.title}
    >
      {native && instance ? (
        <div className="flex shrink-0 justify-end border-b border-cream/10 px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void permissions.open(instance);
            }}
          >
            App permissions
          </Button>
        </div>
      ) : null}
      {permissions.controls}
      <div ref={element} className="relative min-h-0 flex-1">
        {!native ? (
          <div role="status">
            {props.title} needs an isolated native App view. This platform does not support it yet.
          </div>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button onClick={() => setAttempt((value) => value + 1)}>Try again</button>
          </div>
        ) : !ready ? (
          <div role="status">Opening {props.title}…</div>
        ) : null}
      </div>
    </div>
  );
}
