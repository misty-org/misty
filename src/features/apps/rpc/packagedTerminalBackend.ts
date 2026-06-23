import type { TerminalRpcBackend } from "./terminal";

/** Native instance authority is supplied by the mounted app, never package params. */
export function createPackagedTerminalBackend(
  backend: TerminalRpcBackend,
  options: { instance(): Promise<string>; authorize(): Promise<unknown> },
): TerminalRpcBackend {
  return {
    listen: backend.listen.bind(backend),
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      if (
        ![
          "terminal_create",
          "terminal_kill",
          "terminal_write",
          "terminal_resize",
          "terminal_interrupt",
          "terminal_ssh_environments",
          "terminal_ssh_preflight",
          "terminal_ssh_trust_host",
        ].includes(command)
      )
        throw new Error("Unknown terminal service operation.");
      if (command === "terminal_create" || command.startsWith("terminal_ssh_"))
        await options.authorize();
      const instance = await options.instance();
      if (command === "terminal_create")
        return backend.invoke<T>("terminal_service_create", { instance, request: args.request });
      if (command === "terminal_kill")
        return backend.invoke<T>("terminal_service_close", { instance, sessionId: args.sessionId });
      const operation = {
        terminal_write: { operation: "write", data: args.data },
        terminal_resize: {
          operation: "resize",
          cols: args.cols,
          rows: args.rows,
          pixelWidth: args.pixelWidth,
          pixelHeight: args.pixelHeight,
        },
        terminal_interrupt: { operation: "interrupt" },
      }[command];
      if (operation)
        return backend.invoke<T>("terminal_service_call", {
          instance,
          sessionId: args.sessionId,
          command: operation,
        });
      const ssh = {
        terminal_ssh_environments: { operation: "sshEnvironments" },
        terminal_ssh_preflight: { operation: "sshPreflight", connection: args.connection },
        terminal_ssh_trust_host: { operation: "sshTrust", request: args.request },
      }[command];
      if (ssh) return backend.invoke<T>("terminal_service_request", { instance, command: ssh });
      throw new Error("Unknown terminal service operation.");
    },
  };
}
