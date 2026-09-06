import {
  isMistyBrowserMethod,
  mistyBrowserContracts,
  MistyBrowserEventSchema,
  MistyBrowserUrlSchema,
  MistyBrowserInspectionSchema,
  type MistyBrowserInspection,
  type MistyBrowserBounds,
  type MistyBrowserEvent,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";

export interface BrowserRpcBackend {
  initialUrl(): string;
  constrainBounds(bounds: MistyBrowserBounds): MistyBrowserBounds;
  create(input: {
    id: string;
    scopeId: string;
    url: string;
    bounds: MistyBrowserBounds;
    nativeLiveResize: boolean;
  }): Promise<void>;
  layout(input: {
    id: string;
    bounds: MistyBrowserBounds;
    visible: boolean;
    nativeLiveResize: boolean;
  }): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  back(id: string): Promise<void>;
  forward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  inspect(id: string): Promise<Omit<MistyBrowserInspection, "documentId">>;
  click(id: string, elementRef: string): Promise<void>;
  overlay(id: string, reason: string, active: boolean): Promise<void>;
  hide(id: string): Promise<void>;
  close(id: string): Promise<void>;
  subscribe(id: string, listener: (event: MistyBrowserEvent) => void): Promise<() => void>;
}
interface OwnedBrowser {
  nativeId: string;
  contextId: string;
  generation: number;
  inspection?: MistyBrowserInspection;
  closed: boolean;
  ready: Promise<void>;
  queue: Promise<unknown>;
  cleanup?: Promise<void>;
  unlisten?: () => void;
  listeners: Set<(event: MistyBrowserEvent) => void>;
  pending: MistyBrowserEvent[];
}

/** A component owns one native browser view. Native IDs never enter the SDK. */
export function createBrowserRpc(scope: AppRpcScope, backend: BrowserRpcBackend) {
  const views = new Map<string, OwnedBrowser>();
  const cleanups = new Set<Promise<void>>();
  let closed = false;
  let closing = 0;
  const assert = () => {
    scope.assert("browser.navigate");
    if (closed) throw new AppRpcError("app_closed", "The browser runtime has closed.");
  };
  const emit = (view: OwnedBrowser, event: MistyBrowserEvent) => {
    try {
      assert();
    } catch {
      return;
    }
    if (view.closed) return;
    const parsed = MistyBrowserEventSchema.safeParse(event);
    if (!parsed.success) return;
    if (parsed.data.type === "page" && parsed.data.phase === "started") {
      view.generation++;
      view.inspection = undefined;
    }
    if (!view.listeners.size) {
      view.pending.push(parsed.data);
      if (view.pending.length > 32) view.pending.shift();
    } else
      for (const listener of view.listeners) {
        try {
          listener(parsed.data);
        } catch (error) {
          console.error("App browser subscriber failed", error);
        }
      }
  };
  const remove = (handle: string, view: OwnedBrowser) => {
    if (view.cleanup) return view.cleanup;
    views.delete(handle);
    view.closed = true;
    view.listeners.clear();
    view.pending.length = 0;
    closing++;
    const unlisten = () => {
      const stop = view.unlisten;
      view.unlisten = undefined;
      stop?.();
    };
    unlisten();
    // Hide promptly when a tab/account closes, even if a native request is
    // still pending. Destruction waits for creation/operations to settle.
    void backend.hide(view.nativeId).catch(() => undefined);
    view.cleanup = (async () => {
      await view.ready.catch(() => undefined);
      await view.queue.catch(() => undefined);
      unlisten();
      await backend.close(view.nativeId);
    })().finally(() => {
      closing--;
    });
    cleanups.add(view.cleanup);
    void view.cleanup.then(
      () => cleanups.delete(view.cleanup!),
      () => cleanups.delete(view.cleanup!),
    );
    return view.cleanup;
  };
  const close = async () => {
    closed = true;
    for (const [handle, view] of views) void remove(handle, view).catch(() => undefined);
    await Promise.allSettled([...cleanups]);
  };
  scope.signal.addEventListener(
    "abort",
    () => {
      void close();
    },
    { once: true },
  );
  const owned = (handle: string) => {
    const view = views.get(handle);
    if (!view || view.closed)
      throw new AppRpcError(
        "resource_denied",
        "This browser view does not belong to this App instance.",
      );
    return view;
  };
  return {
    close,
    async request(message: { method: string; params?: unknown }): Promise<unknown> {
      assert();
      if (!isMistyBrowserMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown browser SDK method.");
      const { method } = message;
      const contract = mistyBrowserContracts[method];
      scope.assert(contract.capability);
      const input = contract.params.parse(message.params ?? {});
      if (method === "browser.create") {
        if (views.size || closing)
          throw new AppRpcError(
            "resource_limit",
            "This App view already owns a browser. Open another workspace tab for another page.",
          );
        const options = input as {
          url?: string;
          bounds: MistyBrowserBounds;
          nativeLiveResize: boolean;
        };
        const bounds = backend.constrainBounds(options.bounds);
        const url = MistyBrowserUrlSchema.parse(options.url ?? backend.initialUrl());
        const handle = crypto.randomUUID();
        const view: OwnedBrowser = {
          nativeId: `sdk-browser-${crypto.randomUUID()}`,
          contextId: crypto.randomUUID(),
          generation: 0,
          closed: false,
          ready: Promise.resolve(),
          queue: Promise.resolve(),
          listeners: new Set(),
          pending: [],
        };
        views.set(handle, view);
        view.ready = (async () => {
          view.unlisten = await backend.subscribe(view.nativeId, (event) => emit(view, event));
          assert();
          if (view.closed)
            throw new AppRpcError("view_closed", "The browser view closed while loading.");
          await backend.create({
            id: view.nativeId,
            scopeId: view.contextId,
            url,
            bounds: backend.constrainBounds(bounds),
            nativeLiveResize: options.nativeLiveResize,
          });
          assert();
        })();
        try {
          await view.ready;
          return contract.result.parse({ handle, url, contextId: view.contextId });
        } catch (error) {
          await remove(handle, view).catch(() => undefined);
          throw error;
        }
      }
      const options = input as {
        handle: string;
        bounds?: MistyBrowserBounds;
        visible?: boolean;
        nativeLiveResize?: boolean;
        url?: string;
        documentId?: string;
        elementRef?: string;
        reason?: string;
        active?: boolean;
      };
      const view = owned(options.handle);
      if (method === "browser.close") {
        await remove(options.handle, view);
        assert();
        return undefined;
      }
      const operation = view.queue
        .catch(() => undefined)
        .then(async () => {
          await view.ready;
          assert();
          scope.assert(contract.capability);
          owned(options.handle);
          let result: unknown;
          if (
            ["browser.navigate", "browser.back", "browser.forward", "browser.reload"].includes(
              method,
            )
          ) {
            view.generation++;
            view.inspection = undefined;
          }
          switch (method) {
            case "browser.inspect": {
              view.inspection = undefined;
              const generation = view.generation;
              const snapshot = await backend.inspect(view.nativeId);
              if (generation !== view.generation)
                throw new AppRpcError(
                  "document_changed",
                  "The page changed during inspection. Inspect it again.",
                );
              const inspection = MistyBrowserInspectionSchema.parse({
                ...snapshot,
                documentId: crypto.randomUUID(),
              });
              view.inspection = inspection;
              result = inspection;
              break;
            }
            case "browser.click": {
              const inspection = view.inspection;
              if (
                !inspection ||
                inspection.documentId !== options.documentId ||
                !inspection.interactive.some((element) => element.ref === options.elementRef)
              )
                throw new AppRpcError(
                  "document_changed",
                  "Inspect this page again before interacting with it.",
                );
              // A click can change page meaning without navigation. Require a
              // fresh snapshot for the next action, including after failures.
              view.inspection = undefined;
              await backend.click(view.nativeId, options.elementRef!);
              break;
            }
            case "browser.overlay":
              await backend.overlay(view.nativeId, options.reason!, options.active!);
              break;
            case "browser.layout":
              await backend.layout({
                id: view.nativeId,
                bounds: options.visible
                  ? backend.constrainBounds(options.bounds!)
                  : options.bounds!,
                visible: options.visible!,
                nativeLiveResize: options.nativeLiveResize!,
              });
              break;
            case "browser.navigate":
              await backend.navigate(view.nativeId, options.url!);
              break;
            case "browser.back":
              await backend.back(view.nativeId);
              break;
            case "browser.forward":
              await backend.forward(view.nativeId);
              break;
            case "browser.reload":
              await backend.reload(view.nativeId);
              break;
          }
          assert();
          scope.assert(contract.capability);
          owned(options.handle);
          return contract.result.parse(result);
        });
      view.queue = operation;
      return operation;
    },
    async subscribe(topic: string, listener: (event: unknown) => void) {
      assert();
      if (!topic.startsWith("browser:"))
        throw new AppRpcError("unsupported_topic", "Unknown browser event subscription.");
      const view = owned(topic.slice("browser:".length));
      view.listeners.add(listener);
      const pending = view.pending.splice(0);
      for (const event of pending) emit(view, event);
      return () => {
        view.listeners.delete(listener);
      };
    },
  };
}
