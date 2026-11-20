import { describe, expect, it } from "vitest";
import { createAppMcpClient } from "./appMcpClient";
import { appToolName } from "./appTools";

type Message = { id?: number; method?: string; params?: Record<string, unknown> };

/** An app's MCP server answering over a loopback; `startAfter` messages are dropped as an app still starting. */
function loopback(options: { startAfter?: number } = {}) {
  let dropped = 0;
  const seen: Message[] = [];
  const client = createAppMcpClient(
    (raw) => {
      const message = raw as Message;
      seen.push(message);
      if (message.id === undefined) return;
      if (dropped < (options.startAfter ?? 0)) {
        dropped += 1;
        return;
      }
      const answer = (result: unknown) =>
        queueMicrotask(() => client.receive({ jsonrpc: "2.0", id: message.id, result }));
      if (message.method === "initialize")
        answer({ protocolVersion: "2025-03-26", capabilities: { tools: {} } });
      else if (message.method === "tools/list")
        answer(
          message.params?.cursor
            ? { tools: [{ name: "b" }] }
            : { tools: [{ name: "a" }], nextCursor: "2" },
        );
      else if (message.method === "tools/call") answer({ content: [{ type: "text", text: "ok" }] });
    },
    { retryMs: 5, startTimeoutMs: 1_000, requestTimeoutMs: 1_000 },
  );
  return { client, seen };
}

describe("createAppMcpClient", () => {
  it("handshakes, lists every page of tools and calls one", async () => {
    const { client, seen } = loopback();
    expect((await client.listTools()).map((tool) => tool.name)).toEqual(["a", "b"]);
    expect(seen.map((m) => m.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/list",
    ]);
    expect(await client.callTool("a", { x: 1 })).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    expect(seen.at(-1)).toMatchObject({
      method: "tools/call",
      params: { name: "a", arguments: { x: 1 } },
    });
    client.dispose();
  });

  it("asks again while the app is still starting its server", async () => {
    const { client, seen } = loopback({ startAfter: 2 });
    await expect(client.listTools()).resolves.toHaveLength(2);
    expect(seen.filter((m) => m.method === "initialize").length).toBe(3);
    client.dispose();
  });

  it("rejects pending calls when the app closes", async () => {
    const client = createAppMcpClient(() => {}, {
      requestTimeoutMs: 5_000,
      startTimeoutMs: 5_000,
      retryMs: 5,
    });
    const listing = client.listTools();
    client.dispose();
    await expect(listing).rejects.toThrow();
  });
});

describe("appToolName", () => {
  it("matches native's internal name", () => {
    expect(appToolName("photo-craft", "get.size")).toBe("app.photo-craft.get_size");
  });
});
