// A throwaway HTTP server on this computer, standing in for a provider, the stack or the bridge.
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Seen {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface Mock {
  url: string;
  seen: Seen[];
  close(): Promise<void>;
}

export async function startMock(handle: (request: Seen, response: ServerResponse) => void): Promise<Mock> {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const item = { method: request.method ?? "", path: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(item);
      handle(item, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

export function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}
