import type { McpConnection, McpConnectionInput, McpToolDescriptor } from "./types";

const connectionPath = (connectionId: string) =>
  `/mcp/connections/${encodeURIComponent(connectionId)}`;

// MCP transport details stay here. Renderer state only receives public DTOs;
// bearer tokens are write-only request input and are never stored.
export function createMcpConnectionsApi(apiRequest:<T=void>(path:string,init?:RequestInit)=>Promise<T>,apiBlobRequest:(path:string)=>Promise<Blob> = async()=>{throw new Error('Use the binary operation.');}) {return {
  list: () => apiRequest<{ connections: McpConnection[] }>("/mcp/connections"),
  add: (input: McpConnectionInput) =>
    apiRequest<{ connection: McpConnection }>("/mcp/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  test: (connectionId: string) =>
    apiRequest<{ connection: McpConnection; ok: boolean }>(`${connectionPath(connectionId)}/test`, {
      method: "POST",
    }),
  discover: (connectionId: string) =>
    apiRequest<{ connection: McpConnection; snapshot: unknown; tools: McpToolDescriptor[] }>(
      `${connectionPath(connectionId)}/discover`,
      { method: "POST" },
    ),
  tools: (connectionId: string) =>
    apiRequest<{ tools: McpToolDescriptor[] }>(`${connectionPath(connectionId)}/tools`),
  remove: (connectionId: string) =>
    apiRequest<void>(connectionPath(connectionId), { method: "DELETE" }),
};}
