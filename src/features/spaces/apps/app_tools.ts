import { LocalToolRejected } from "@/features/agents";
import type { LocalToolHandler } from "@/features/agents";
import { invoke } from "@/native";
import { AGENT_META, agentOfRun, noteAppAgent } from "./app_agents";
import { createAppMcpClient, McpRemoteError, McpUnreachable } from "./app_mcp_client";
import { registerAppTools, serveAppTools, unregisterAppTools } from "./app_tool_server";
import type { HostChannel } from "./host_channel";
import type { ToolDefinition } from "./app_screen_tools";
import { ScreenRefused } from "./app_screen";
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

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const maybeRan = (error: unknown) =>
  new Error(
    `${messageOf(error)} It may or may not have run in the app; check before doing it again.`,
  );

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
  let live = true;
  let offering: Promise<void> = Promise.resolve();
  let onError: (error: Error) => void = () => {};
  const stopServing = serveAppTools();
  const client = createAppMcpClient((message) => channel?.sendMcp(message), {
    onToolsChanged: () => reoffer(),
  });

  const callerOf = async (runId: string) => {
    const agent = await agentOfRun(runId);
    noteAppAgent(session, agent);
    return agent;
  };

  const offer = async () => {
    const tools = options.mcp ? await client.listTools() : [];
    if (!live) return;
    const handlers: Record<string, LocalToolHandler> = {
      ...(extra?.handlers((tool) => appToolName(appId, tool)) ?? {}),
    };
    for (const tool of tools) {
      handlers[appToolName(appId, tool.name)] = async ({ input, signal, runId }) => {
        const agent = await callerOf(runId);
        let result;
        try {
          result = await client.callTool(tool.name, input, signal, { [AGENT_META]: agent });
        } catch (error) {
          if (error instanceof McpRemoteError || error instanceof McpUnreachable)
            throw new LocalToolRejected("app_tool_failed", messageOf(error));
          throw maybeRan(error);
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
      handlers[appToolName(appId, tool.name)] = async ({ input, runId }) => {
        const agent = await callerOf(runId);
        try {
          return await options.adapter!.command("adapter.call", { name: tool.name, args: input, agent });
        } catch (error) {
          if (error instanceof ScreenRefused)
            throw new LocalToolRejected("app_tool_failed", messageOf(error));
          throw maybeRan(error);
        }
      };
    }
    tools.push(
      ...adapted.map((tool) => ({ ...tool, inputSchema: tool.inputSchema ?? { type: "object" } })),
    );
    registerAppTools(session, handlers);
    const own = new Set(tools.map((tool) => tool.name));
    const screen = (extra?.definitions ?? []).filter((tool) => !own.has(tool.name));
    await invoke<number>("space_app_mcp_register", { session, tools: [...tools, ...screen] });
  };

  function reoffer() {
    if (!live || !channel) return;
    offering = offering
      .then(() => (live ? offer() : undefined))
      .catch((error: unknown) => {
        if (live) onError(error instanceof Error ? error : new Error(String(error)));
      });
  }

  return {
    attach(next: HostChannel, failed: (error: Error) => void) {
      channel = next;
      onError = failed;
      reoffer();
    },
    receive: (message: unknown) => client.receive(message),
    dispose() {
      live = false;
      client.dispose();
      unregisterAppTools(session);
      stopServing();
      void invoke("space_app_mcp_unregister", { session }).catch(() => {});
    },
  };
}
