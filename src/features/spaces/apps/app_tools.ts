import { LocalToolRejected, registerLocalTools, unregisterLocalTools } from "@/features/agents";
import type { LocalToolHandler } from "@/features/agents";
import { invoke } from "@/native";
import { createAppMcpClient } from "./app_mcp_client";
import type { HostChannel } from "./host_channel";
import type { ToolDefinition } from "./app_screen_tools";
import type { ScreenChannel } from "./app_screen";

export const appToolName = (appId: string, tool: string) =>
  `app.${appId}.${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const textOf = (content: unknown[] | undefined) =>
  (content ?? [])
    .map((part) =>
      part && typeof part === "object" ? (part as { text?: unknown }).text : undefined,
    )
    .filter((text): text is string => typeof text === "string")
    .join("\n");

export function offerAppTools(options: {
  appId: string;
  session: string;
  mcp: boolean;
  adapter?: ScreenChannel;
  extra?: {
    definitions: ToolDefinition[];
    handlers(name: (tool: string) => string): Record<string, LocalToolHandler>;
  };
}) {
  const { appId, session, extra } = options;
  let channel: HostChannel | undefined;
  let names: string[] = [];
  let live = true;
  const client = createAppMcpClient((message) => channel?.sendMcp(message));

  const offer = async () => {
    const tools = options.mcp ? await client.listTools() : [];
    if (!live) return;
    const handlers: Record<string, LocalToolHandler> = {
      ...(extra?.handlers((tool) => appToolName(appId, tool)) ?? {}),
    };
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
    const adapted = options.adapter
      ? (
          (await options.adapter.command<{ tools: ToolDefinition[] }>("adapter.tools")).tools ?? []
        ).filter(
          (tool) => typeof tool?.name === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(tool.name),
        )
      : [];
    if (!live) return;
    for (const tool of adapted) {
      handlers[appToolName(appId, tool.name)] = async ({ input }) => {
        try {
          return await options.adapter!.command("adapter.call", { name: tool.name, args: input });
        } catch (error) {
          throw new LocalToolRejected(
            "app_tool_failed",
            error instanceof Error ? error.message : String(error),
          );
        }
      };
    }
    tools.push(
      ...adapted.map((tool) => ({ ...tool, inputSchema: tool.inputSchema ?? { type: "object" } })),
    );
    names = Object.keys(handlers);
    registerLocalTools(handlers);
    const own = new Set(tools.map((tool) => tool.name));
    const screen = (extra?.definitions ?? []).filter((tool) => !own.has(tool.name));
    await invoke<number>("space_app_mcp_register", { session, tools: [...tools, ...screen] });
  };

  return {
    attach(next: HostChannel, onError: (error: Error) => void) {
      channel = next;
      offer().catch((error: unknown) => {
        if (live) onError(error instanceof Error ? error : new Error(String(error)));
      });
    },
    receive: (message: unknown) => client.receive(message),
    dispose() {
      live = false;
      client.dispose();
      unregisterLocalTools(names);
      void invoke("space_app_mcp_unregister", { session }).catch(() => {});
    },
  };
}
