import { createRoot } from "react-dom/client";
import {
  defineComponentApp,
  type MistyComponentDefinition,
  type MistyComponentSession,
} from "@misty/sdk";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createSdkCodeSessionState } from "./sdkCodeSessionState";
import { createSdkCodeWorkspace } from "./createSdkCodeWorkspace";

type MountInput = Parameters<MistyComponentDefinition["mount"]>[0];
type Services = Parameters<typeof createSdkCodeWorkspace>[3];
/** The full Code component lifecycle. Remaining language/AI adapters are supplied
 * explicitly by the app assembly; app-local state is allocated once per host session. */
export function createSdkCodeComponent(
  createServices: (
    input: MountInput & {
      runtime: ReturnType<typeof createSdkCodeRuntime>;
    },
  ) => Promise<{
    services: Services;
    spaceId?: string;
    close(): void | Promise<void>;
    update?(context: MountInput["context"]): void;
  }>,
) {
  const createSession: NonNullable<MistyComponentDefinition["createSession"]> = ({ signal }) => {
    const state = createSdkCodeSessionState();
    const mounts = new Set<() => Promise<void>>();
    let closed = false;
    let sessionClosing: Promise<void> | undefined;
    const session: MistyComponentSession = {
      async mount(input) {
        if (closed || signal.aborted) throw new Error("This Code session is closed.");
        const lifetime = new AbortController();
        const runtime = createSdkCodeRuntime(input.misty, lifetime.signal, state);
        let services: Awaited<ReturnType<typeof createServices>> | undefined;
        let workspace: Awaited<ReturnType<typeof createSdkCodeWorkspace>> | undefined;
        let root: ReturnType<typeof createRoot> | undefined;
        let closing: Promise<void> | undefined;
        let servicesClosing: Promise<void> | undefined;
        const closeServices = () =>
          services
            ? (servicesClosing ??= Promise.resolve().then(() => services!.close()))
            : Promise.resolve();
        const assert = () => {
          if (closed || lifetime.signal.aborted || input.signal?.aborted)
            throw new Error("This Code view is closed.");
        };
        const close = () => {
          if (closing) return closing;
          input.signal?.removeEventListener("abort", abort);
          lifetime.abort();
          mounts.delete(close);
          closing = Promise.resolve().then(async () => {
            try {
              root?.unmount();
              workspace?.close();
            } finally {
              try {
                await closeServices();
              } finally {
                await runtime.close();
              }
            }
          });
          return closing;
        };
        const abort = () => {
          void close().catch(() => undefined);
        };
        mounts.add(close);
        input.signal?.addEventListener("abort", abort, { once: true });
        try {
          assert();
          services = await createServices({ ...input, signal: lifetime.signal, runtime });
          // A late adapter must be disposed even if close already ran while awaiting it.
          if (lifetime.signal.aborted || closed) {
            await closeServices();
            assert();
          }
          workspace = await createSdkCodeWorkspace(
            runtime,
            input.misty,
            {
              viewId: input.context.instanceId,
              spaceId: services.spaceId,
              signal: lifetime.signal,
            },
            services.services,
          );
          assert();
          root = createRoot(input.root);
          root.render(<workspace.Workspace />);
          return {
            update(context) {
              assert();
              services?.update?.(context);
            },
            unmount: close,
          };
        } catch (error) {
          await close().catch(() => undefined);
          throw error;
        }
      },
      async close() {
        if (sessionClosing) return sessionClosing;
        closed = true;
        signal.removeEventListener("abort", abortSession);
        sessionClosing = Promise.allSettled([...mounts].map((close) => close())).then(() =>
          state.close(),
        );
        return sessionClosing;
      },
    };
    const abortSession = () => {
      void session.close();
    };
    signal.addEventListener("abort", abortSession, { once: true });
    if (signal.aborted) abortSession();
    return session;
  };
  return defineComponentApp({
    appId: "code",
    protocol: 2,
    createSession,
    async mount(input) {
      const session = await createSession({
        signal: input.signal ?? new AbortController().signal,
        libraries: input.libraries,
      });
      try {
        const mounted = await session.mount(input);
        return {
          update: mounted.update.bind(mounted),
          async unmount() {
            try {
              await mounted.unmount();
            } finally {
              await session.close();
            }
          },
        };
      } catch (error) {
        await session.close();
        throw error;
      }
    },
  });
}
