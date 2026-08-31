import { apiRequest } from "@/api/client";
import type { McpConnection } from "../mcp/types";

export interface ActivepiecesFlowsResponse {
  connected: boolean;
  connection?: McpConnection;
  structured_content?: unknown;
  text?: string[];
}

export interface ActivepiecesToolResponse {
  structured_content?: unknown;
  text?: string[];
}

export const automationsApi = {
  flows: () => apiRequest<ActivepiecesFlowsResponse>("/automations/flows"),
  callTool: (toolName: string, arguments_: Record<string, unknown>) =>
    apiRequest<ActivepiecesToolResponse>(`/automations/tools/${encodeURIComponent(toolName)}`, {
      method: "POST",
      body: JSON.stringify({ arguments: arguments_ }),
    }),
};
