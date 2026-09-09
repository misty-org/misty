import type { MistyComponentDefinition } from "@misty/sdk";

/** Install signed package CSS for the lifetime of its mounted component. */
export function attachComponentStyles(root: HTMLElement, url: URL, signal?: AbortSignal) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url.href;
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  let rejectReady: (error: Error) => void;
  const dispose = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    link.onload = link.onerror = null;
    link.remove();
    if (!settled) {
      settled = true;
      rejectReady(new Error("The App closed while loading its styles."));
    }
  };
  const abort = () => dispose();
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    link.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    link.onerror = () => {
      settled = true;
      dispose();
      reject(new Error("The installed App stylesheet could not be loaded."));
    };
    timer = setTimeout(() => {
      settled = true;
      dispose();
      reject(new Error("The installed App stylesheet took too long to load."));
    }, 10000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) dispose();
    else root.append(link);
  });
  return { ready, dispose };
}

/** Decorate a verified package definition; each view owns its stylesheet. */
export function styleComponentDefinition(
  definition: MistyComponentDefinition,
  stylesheet: URL,
): MistyComponentDefinition {
  const styledMount =
    (mount: MistyComponentDefinition["mount"]): MistyComponentDefinition["mount"] =>
    async (input) => {
      const content = document.createElement("div");
      content.className = "h-full min-h-0";
      input.root.append(content);
      const styles = attachComponentStyles(input.root, stylesheet, input.signal);
      try {
        await styles.ready;
        const mounted = await mount({ ...input, root: content });
        return {
          update: mounted.update.bind(mounted),
          async unmount() {
            try {
              await mounted.unmount();
            } finally {
              styles.dispose();
              content.remove();
            }
          },
        };
      } catch (error) {
        styles.dispose();
        content.remove();
        throw error;
      }
    };
  return Object.freeze({
    ...definition,
    mount: styledMount(definition.mount.bind(definition)),
    ...(definition.createSession
      ? {
          async createSession(input) {
            const session = await definition.createSession!(input);
            if (
              !session ||
              typeof session.mount !== "function" ||
              typeof session.close !== "function"
            )
              throw new Error("The App did not export a compatible shared session.");
            return {
              mount: styledMount(session.mount.bind(session)),
              close: session.close.bind(session),
            };
          },
        }
      : {}),
  } satisfies MistyComponentDefinition);
}
