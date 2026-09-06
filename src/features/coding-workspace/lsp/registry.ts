import { LspClient, type CodeLspTransport } from "./client";

/** The downloaded Code runtime supplies its transport and lifetime; project pools never span roots. */
export function createCodeLspRegistry(transport: CodeLspTransport, signal?: AbortSignal) {
  const clients = new Map<string, Map<string, LspClient>>();
  const failures = new Map<string, Map<string, string>>();
  const references = new Map<string, number>();
  let closed = signal?.aborted ?? false;
  const closeRoot = (cwd: string) => {
    const owned = clients.get(cwd);
    clients.delete(cwd);
    failures.delete(cwd);
    for (const client of owned?.values() ?? []) void client.dispose().catch(() => undefined);
  };
  const close = () => {
    closed = true;
    for (const cwd of clients.keys()) closeRoot(cwd);
    failures.clear();
    references.clear();
    signal?.removeEventListener("abort", close);
  };
  if (!closed) signal?.addEventListener("abort", close, { once: true });
  return {
    close,
    retainRoot(cwd: string) {
      if (closed) throw new Error("This Code view is closed.");
      references.set(cwd, (references.get(cwd) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = (references.get(cwd) ?? 1) - 1;
        if (remaining > 0) references.set(cwd, remaining);
        else {
          references.delete(cwd);
          closeRoot(cwd);
        }
      };
    },
    async get(language: string, cwd: string): Promise<LspClient | null> {
      if (closed || failures.get(cwd)?.has(language)) return null;
      let project = clients.get(cwd);
      if (!project) {
        project = new Map();
        clients.set(cwd, project);
      }
      let client = project.get(language);
      if (!client) {
        client = new LspClient(language, cwd, transport, { signal });
        project.set(language, client);
      }
      try {
        await client.ensureStarted();
        if (closed || clients.get(cwd)?.get(language) !== client) return null;
        return client;
      } catch (error) {
        // A late startup from a released project cannot poison its replacement.
        if (clients.get(cwd)?.get(language) === client) {
          project.delete(language);
          let errors = failures.get(cwd);
          if (!errors) {
            errors = new Map();
            failures.set(cwd, errors);
          }
          errors.set(
            language,
            error instanceof Error ? error.message : "Language-server startup failed.",
          );
        }
        void client.dispose().catch(() => undefined);
        return null;
      }
    },
    error(language: string, cwd: string): string | null {
      return failures.get(cwd)?.get(language) ?? null;
    },
    forgetError(language: string, cwd: string) {
      failures.get(cwd)?.delete(language);
    },
  };
}
