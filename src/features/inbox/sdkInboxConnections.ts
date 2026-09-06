import type { MistyAppSDK } from "@misty/sdk";
import { create } from "zustand";
import type { InboxConnectionsState } from "./inboxWorkspaceRuntime";

export function createSdkInboxConnections(misty: MistyAppSDK, userId: string, signal: AbortSignal) {
  const assert = () => {
    if (signal.aborted) throw new Error("This Inbox view is closed.");
  };
  const store = create<InboxConnectionsState>((set) => ({
    accountId: userId,
    authorizingProvider: null,
    removingConnectionId: null,
    error: null,
    setAccount(accountId) {
      assert();
      if (accountId !== userId) throw new Error("This Inbox belongs to another account.");
    },
    async beginAuthorization(provider, capabilities, returnTo) {
      assert();
      set({ authorizingProvider: provider, error: null });
      try {
        const result = await misty.server.call("connections.authorize", {
          path: { provider },
          body: { capabilities: [...capabilities], return_to: returnTo },
        });
        assert();
        return result.authorization_url;
      } catch (error) {
        if (!signal.aborted)
          set({
            error:
              error instanceof Error ? error.message : "This email account could not be connected.",
          });
        throw error;
      } finally {
        if (!signal.aborted) set({ authorizingProvider: null });
      }
    },
    async remove(connectionId) {
      assert();
      set({ removingConnectionId: connectionId, error: null });
      try {
        await misty.server.call("connections.remove", { path: { connectionID: connectionId } });
        assert();
      } catch (error) {
        if (!signal.aborted)
          set({
            error:
              error instanceof Error ? error.message : "This email account could not be removed.",
          });
        throw error;
      } finally {
        if (!signal.aborted) set({ removingConnectionId: null });
      }
    },
    clearError() {
      if (!signal.aborted) set({ error: null });
    },
  }));
  const close = () =>
    store.setState({
      accountId: "",
      authorizingProvider: null,
      removingConnectionId: null,
      error: null,
    });
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) close();
  return store;
}
