import { LocalToolRejected, registerLocalTools, unregisterLocalTools } from "@/features/agents";
import type { LocalToolHandler } from "@/features/agents";
import { invoke } from "@/native";
import { createAppMcpClient } from "./appMcpClient";
import type { HostChannel } from "./hostChannel";

/** Misty's name for an app's tool (`internal_name` and `sanitized` in `src-tauri/features/apps/mcp.rs`). */
export const appToolName = (appId: string, tool: string) =>
  `app.${appId}.${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const textOf = (content: unknown[] | undefined) =>
  (content ?? [])
    .map((part) =>
      part && typeof part === "object" ? (part as { text?: unknown }).text : undefined,
    )
    .filter((text): text is string => typeof text === "string")
    .join("\n");

/**
 * Offers an app's MCP tools to agents. The app's server runs in its frame: this lists its tools, hands
 * the list to native (which offers them to engines and gates every call), and answers each call by
 * calling the app's server. Returns the pieces the channel needs, and how to take it all back down.
 */
export function offerAppTools(options: { appId: string; session: string }) {
  const { appId, session } = options;
  let channel: HostChannel | undefined;
  let names: string[] = [];
  let live = true;
  const client = createAppMcpClient((message) => channel?.sendMcp(message));

  const offer = async () => {
    const tools = await client.listTools();
    if (!live) return;
    const handlers: Record<string, LocalToolHandler> = {};
    for (const tool of tools) {
      handlers[appToolName(appId, tool.name)] = async ({ input, signal }) => {
        let result;
        try {
          result = await client.callTool(tool.name, input, signal);
        } catch (error) {
          throw new LocalToolRejected(
            "app_tool_failed",
            error instanceof Error ? error.message : String(error),
          );
        }
        if (result.isError)
          throw new LocalToolRejected(
            "app_tool_error",
            textOf(result.content) || "The app's tool failed.",
          );
        return { content: result.content ?? [], structuredContent: result.structuredContent };
      };
    }
    names = Object.keys(handlers);
    registerLocalTools(handlers);
    await invoke<number>("space_app_mcp_register", { session, tools });
  };

  return {
    /** Wire in the channel when the frame has loaded; native's list follows once the server answers. */
    attach(next: HostChannel, onError: (error: Error) => void) {
      channel = next;
      offer().catch((error: unknown) => {
        if (live) onError(error instanceof Error ? error : new Error(String(error)));
      });
    },
    /** Where the app's MCP messages go. */
    receive: (message: unknown) => client.receive(message),
    dispose() {
      live = false;
      client.dispose();
      unregisterLocalTools(names);
      void invoke("space_app_mcp_unregister", { session }).catch(() => {});
    },
  };
}
