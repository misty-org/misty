import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRpcScope } from "./session";

afterEach(() => vi.useRealTimers());
describe("SDK request scope", () => {
  it("expires automatically and cancels owned resources even without another request", () => {
    vi.useFakeTimers();
    const scope = createAppRpcScope({
      identity: { appId: "terminal", accountId: "a", instanceId: "tab" },
      scopes: ["terminal.execute"],
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      isCurrentAccount: () => true,
    });
    const cancelled = vi.fn();
    scope.signal.addEventListener("abort", cancelled);
    vi.advanceTimersByTime(1000);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(() => scope.assert()).toThrow("expired");
  });
  it("holds an immutable identity and grant ceiling through refresh", () => {
    const identity = { appId: "journal", accountId: "a", instanceId: "tab" };
    const scopes = ["notes.read"];
    const scope = createAppRpcScope({
      identity,
      scopes,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      isCurrentAccount: (id) => id === "a",
    });
    identity.accountId = "b";
    scopes.push("terminal.execute");
    scope.refresh({ scopes, expiresAt: new Date(Date.now() + 2000).toISOString() });
    expect(scope.identity.accountId).toBe("a");
    expect(() => scope.assert("notes.read")).not.toThrow();
    expect(() => scope.assert("terminal.execute")).toThrow("permission");
    scope.close();
  });
  it("cancels live resources immediately when permissions are removed", () => {
    const scope = createAppRpcScope({
      identity: { appId: "terminal", accountId: "a", instanceId: "tab" },
      scopes: ["terminal.execute"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      isCurrentAccount: () => true,
    });
    const cancelled = vi.fn();
    scope.signal.addEventListener("abort", cancelled);
    scope.refresh({ scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(scope.signal.aborted).toBe(true);
    expect(() => scope.assert()).toThrow("permissions changed");
  });
});
