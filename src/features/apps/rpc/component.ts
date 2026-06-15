import {
  createMistyAppSDK,
  type MistyAppTransport,
  type MistyComponentContext,
  type MistyComponentDefinition,
  type MistyComponentMount,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";
import { componentSessions, type createComponentSessionRegistry } from "./componentSessions";
import { componentLibraries } from "../componentLibraries";

/** A mount owns its DOM root, SDK identity, resources and pending work. Shared app state, when declared, uses a separate host-scoped session. */
export function mountAppComponent(options: {
  definition: MistyComponentDefinition;
  root: HTMLElement;
  context: MistyComponentContext;
  scope: AppRpcScope;
  transport: MistyAppTransport;
  release: () => void;
  sessionKey?: string;
  sessions?: ReturnType<typeof createComponentSessionRegistry>;
}) {
  const { scope } = options;
  if (options.definition.appId !== scope.identity.appId || options.definition.protocol !== 2)
    throw new AppRpcError("invalid_component", "The component does not match this App session.");
  const snapshot = (context: MistyComponentContext) => {
    if (context.instanceId !== scope.identity.instanceId)
      throw new AppRpcError("instance_mismatch", "An App instance cannot change identity.");
    return Object.freeze({ ...context, appearance: Object.freeze({ ...context.appearance }) });
  };
  let context = snapshot(options.context);
  let mounted: MistyComponentMount | undefined;
  let closed = false;
  let cleanup: Promise<void> | undefined;
  let shared: ReturnType<ReturnType<typeof createComponentSessionRegistry>["acquire"]> | undefined;
  const element = document.createElement("div");
  element.className = "h-full min-h-0 w-full";
  options.root.append(element);
  const sdk = createMistyAppSDK({
    registerSurface: options.transport.registerSurface
      ? async (adapter) => {
          scope.assert();
          const remove = await options.transport.registerSurface!(adapter);
          try {
            scope.assert();
          } catch (error) {
            remove();
            throw error;
          }
          return remove;
        }
      : undefined,
    async request(message) {
      scope.assert();
      const result = await options.transport.request(message);
      scope.assert();
      return result;
    },
    subscribe: options.transport.subscribe
      ? async (topic, listener) => {
          scope.assert();
          const remove = await options.transport.subscribe!(topic, (event) => {
            try {
              scope.assert();
            } catch {
              return;
            }
            listener(event);
          });
          try {
            scope.assert();
          } catch (error) {
            remove();
            throw error;
          }
          return remove;
        }
      : undefined,
  });
  function unmount() {
    if (!mounted) {
      shared?.release();
      return cleanup ?? Promise.resolve();
    }
    const instance = mounted;
    mounted = undefined;
    cleanup = Promise.resolve()
      .then(() => instance.unmount())
      .finally(() => shared?.release());
    return cleanup;
  }
  function close() {
    if (!closed) {
      closed = true;
      scope.signal.removeEventListener("abort", onAbort);
      // Remove the owned root before waiting for async app code. A late mount
      // can only write to a detached element and receives an expired SDK.
      element.remove();
      scope.close();
      try {
        options.release();
      } catch (error) {
        // Application cleanup still runs if a host adapter reports a teardown error.
        return unmount().then(() => {
          throw error;
        });
      }
    }
    return unmount();
  }
  const onAbort = () => {
    void close().catch(() => undefined);
  };
  scope.signal.addEventListener("abort", onAbort, { once: true });
  const ready = (async () => {
    try {
      scope.assert();
      const initial = context;
      let mount = options.definition.mount.bind(options.definition);
      if (options.definition.createSession) {
        shared = (options.sessions ?? componentSessions).acquire(
          options.sessionKey ?? "",
          options.definition,
          componentLibraries,
          () => scope.close(),
        );
        const session = await shared.ready;
        scope.assert();
        mount = session.mount.bind(session);
      }
      const result = await mount({
        root: element,
        signal: scope.signal,
        libraries: componentLibraries,
        misty: sdk,
        context: initial,
      });
      if (!result || typeof result.update !== "function" || typeof result.unmount !== "function")
        throw new AppRpcError("invalid_component", "The App did not return a component lifecycle.");
      mounted = result;
      if (closed) {
        await unmount();
        throw new AppRpcError("app_closed", "The App closed before it finished mounting.");
      }
      scope.assert();
      if (initial !== context) mounted.update(context);
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
  })();
  return {
    ready,
    update(next: MistyComponentContext) {
      scope.assert();
      context = snapshot(next);
      try {
        mounted?.update(context);
      } catch (error) {
        void close().catch(() => undefined);
        throw error;
      }
    },
    close,
  };
}
