import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkInboxConnections } from "./sdkInboxConnections";

it("authorizes and removes named connections through the scoped SDK and surfaces failures", async () => {
  const request = vi.fn(async (input: { method: string; params?: unknown }): Promise<unknown> => {
    if (input.method === "connections.authorize")
      return {
        provider: "google",
        authorization_url: "https://accounts.example.invalid/authorize",
      };
    if (input.method === "connections.remove") throw new Error("Connection permission denied.");
  });
  const lifetime = new AbortController();
  const store = createSdkInboxConnections(
    createMistyAppSDK({ request }),
    "account-a",
    lifetime.signal,
  );
  try {
    await expect(store.getState().beginAuthorization("google", ["mail"], "/inbox")).resolves.toBe(
      "https://accounts.example.invalid/authorize",
    );
    expect(request).toHaveBeenCalledWith({
      method: "connections.authorize",
      params: {
        path: { provider: "google" },
        body: { capabilities: ["mail"], return_to: "/inbox" },
      },
    });
    expect(store.getState().authorizingProvider).toBeNull();
    await expect(store.getState().remove("connection-a")).rejects.toThrow("permission denied");
    expect(request).toHaveBeenLastCalledWith({
      method: "connections.remove",
      params: { path: { connectionID: "connection-a" } },
    });
    expect(store.getState()).toMatchObject({
      error: "Connection permission denied.",
      removingConnectionId: null,
    });
    expect(() => store.getState().setAccount("account-b")).toThrow("another account");
  } finally {
    lifetime.abort();
  }
});

it("does not deliver late authorization URLs or retain identity after its view closes", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        finish = resolve;
      }),
  );
  const lifetime = new AbortController();
  const store = createSdkInboxConnections(
    createMistyAppSDK({ request }),
    "account-a",
    lifetime.signal,
  );
  const pending = store.getState().beginAuthorization("google", ["mail"], "/inbox");
  lifetime.abort();
  finish({ provider: "google", authorization_url: "https://accounts.example.invalid/authorize" });
  await expect(pending).rejects.toThrow("closed");
  expect(store.getState()).toMatchObject({ accountId: "", error: null, authorizingProvider: null });
  await expect(store.getState().remove("connection-a")).rejects.toThrow("closed");
  expect(request.mock.calls).toHaveLength(2); // SDK readiness plus the pending authorization; no removal.
});
