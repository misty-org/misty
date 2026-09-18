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

export function createAutomationsApi(apiRequest:<T=void>(path:string,init?:RequestInit)=>Promise<T>,apiBlobRequest:(path:string)=>Promise<Blob> = async()=>{throw new Error('Use the binary operation.');}) {return {
  flows: () => apiRequest<ActivepiecesFlowsResponse>("/automations/flows"),
  callTool: (toolName: string, arguments_: Record<string, unknown>) =>
    apiRequest<ActivepiecesToolResponse>(`/automations/tools/${encodeURIComponent(toolName)}`, {
      method: "POST",
      body: JSON.stringify({ arguments: arguments_ }),
    }),
};}
