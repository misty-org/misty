import { create } from "zustand";
import {
  socialOperations,
  type MistyAppSDK,
  type MistyComponentContext,
  type MistySocialOperation,
} from "@misty/sdk";
import { createSdkLibraryRuntime } from "../library/sdkLibraryRuntime";
import { MistyPickerShell } from "@/features/picker/MistyPickerShell";
import { useSdkSpaceChatDraft } from "@/features/chat-composer/useSdkSpaceChatDraft";
import {
  buildMessageSpans,
  mergeSpaceMessages,
  messageFromSpaceEvent,
} from "./store/useSpaceMessageSpansStore";
import { configureSocialRuntime, type SocialRuntime } from "./socialRuntime";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";

export async function createSdkSocialRuntime(
  misty: MistyAppSDK,
  context: MistyComponentContext,
  signal: AbortSignal,
  report: (error: unknown) => void,
) {
  const identity = await misty.context.get();
  if (!identity.user?.id || !identity.space?.id) throw new Error("Open Social in a Space.");
  const user = identity.user,
    spaceId = identity.space.id;
  const library = await createSdkLibraryRuntime(misty, context, signal, report);
  const assert = () => {
    if (signal.aborted) throw new Error("This Social view is closed.");
  };
  const api = new Proxy({} as SocialRuntime["api"], {
    get: (_, key) => {
      if (key === "memberAvatar")
        return async (id: string, member: string) => {
          const value = await misty.social.read("memberAvatar", id, member);
          return new Blob([value.bytes], { type: value.mimeType });
        };
      if (key === "downloadAttachment")
        return async (id: string, attachment: string, name: string) => {
          const value = await misty.social.read("attachmentContent", id, attachment);
          assert();
          const url = URL.createObjectURL(new Blob([value.bytes], { type: value.mimeType }));
          const link = document.createElement("a");
          link.href = url;
          link.download = name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
      if (socialOperations.includes(key as MistySocialOperation))
        return async (...args: unknown[]) => {
          assert();
          const result = await misty.social.perform(key as MistySocialOperation, wireArgs(args));
          assert();
          return result;
        };
      return library.api[key as keyof typeof library.api];
    },
  });
  type Store = ReturnType<SocialRuntime["useSpacesStore"]["getState"]>;
  const merge = (messages: SpaceMessage[]) =>
    store.setState((s) => ({
      messagesBySpace: {
        ...s.messagesBySpace,
        [spaceId]: mergeSpaceMessages(s.messagesBySpace[spaceId] ?? [], messages),
      },
    }));
  const store = create<Store>(
    (set, get) =>
      ({
        spaces: library.runtime.useSpacesStore.getState().spaces,
        referenceOnly: false,
        messagesBySpace: {},
        messageLoadingBySpace: {},
        messageErrorsBySpace: {},
        membersBySpace: {},
        nodesBySpace: {},
        agentsBySpace: {},
        presenceBySpace: {},
        loading: false,
        sending: false,
        clearError: () => set({ error: null, messageErrorsBySpace: {} }),
        loadMembers: async (id: string) => {
          const result = await api.members(id);
          assert();
          set((s) => ({ membersBySpace: { ...s.membersBySpace, [id]: result.members ?? [] } }));
        },
        loadChatAgents: async (id: string) => {
          const result = await api.chatAgents(id);
          assert();
          set((s) => ({ agentsBySpace: { ...s.agentsBySpace, [id]: result.agents ?? [] } }));
        },
        loadMessages: async (id: string, before?: number) => {
          set((s) => ({ messageLoadingBySpace: { ...s.messageLoadingBySpace, [id]: true } }));
          try {
            const result = await api.messages(id, before);
            assert();
            merge([...result.messages].reverse());
          } catch (error) {
            if (!signal.aborted)
              set((s) => ({
                messageErrorsBySpace: { ...s.messageErrorsBySpace, [id]: String(error) },
              }));
          } finally {
            if (!signal.aborted)
              set((s) => ({ messageLoadingBySpace: { ...s.messageLoadingBySpace, [id]: false } }));
          }
        },
        sendMessage: async (
          id,
          text,
          fileIds = [],
          attachmentIds = [],
          libraryIds = [],
          reply = "",
          selected = {},
          optimistic,
        ) => {
          if (optimistic) merge([optimistic]);
          set({ sending: true });
          try {
            const result = await api.sendMessage(
              id,
              buildMessageSpans(
                text,
                get().membersBySpace[id] ?? [],
                get().agentsBySpace[id] ?? [],
                selected,
              ),
              fileIds,
              attachmentIds,
              libraryIds,
              reply,
              optimistic?.client_nonce ?? "",
            );
            assert();
            result.message.triggered_runs = result.triggered_runs as SpaceMessage["triggered_runs"];
            merge([result.message]);
            return;
          } catch (error) {
            if (!signal.aborted) {
              if (optimistic) merge([{ ...optimistic, local_delivery_state: "failed" }]);
              set((s) => ({
                messageErrorsBySpace: { ...s.messageErrorsBySpace, [id]: String(error) },
              }));
            }
            throw error;
          } finally {
            if (!signal.aborted) set({ sending: false });
          }
        },
        updateMessage: async (id, message, text, files = []) => {
          const result = await api.updateMessage(
            id,
            message,
            buildMessageSpans(text, get().membersBySpace[id] ?? [], get().agentsBySpace[id] ?? []),
            files,
          );
          merge([result]);
        },
        deleteMessage: async (id, message) => {
          await api.deleteMessage(id, message);
          set((s) => ({
            messagesBySpace: {
              ...s.messagesBySpace,
              [id]: (s.messagesBySpace[id] ?? []).filter((m) => m.id !== message),
            },
          }));
        },
        toggleMessageReaction: async (id, message, emoji, reacted) => {
          merge([
            await (reacted ? api.removeMessageReaction : api.addMessageReaction)(
              id,
              message,
              emoji,
            ),
          ]);
        },
        markRead: async (id, seq) => {
          await api.markRead(id, seq);
        },
        openNode: async (id, node) => {
          await misty.social.openNode(id, node);
        },
      } satisfies Partial<Store>) as unknown as Store,
  );
  const connections = create<ReturnType<SocialRuntime["useConnectionsStore"]["getState"]>>(
    (set) =>
      ({
        accountId: user.id,
        connections: [],
        loading: false,
        authorizingProvider: null,
        error: null,
        setAccount: (id: string) => {
          assert();
          if (id !== user.id) throw new Error("This Social view belongs to another account.");
        },
        load: async () => {
          set({ loading: true });
          try {
            const value = await misty.server.call("connections.list", {});
            assert();
            set({ connections: (value.connections ?? []) as never, error: null });
          } catch (error) {
            if (!signal.aborted) set({ error: String(error) });
          } finally {
            if (!signal.aborted) set({ loading: false });
          }
        },
        beginAuthorization: async (provider, capabilities, returnTo) => {
          set({ authorizingProvider: provider });
          try {
            const value = await misty.server.call("connections.authorize", {
              path: { provider },
              body: { capabilities, return_to: returnTo ?? "/apps/social" },
            });
            assert();
            return value.authorization_url;
          } finally {
            if (!signal.aborted) set({ authorizingProvider: null });
          }
        },
        clearError: () => set({ error: null }),
      } satisfies Partial<ReturnType<SocialRuntime["useConnectionsStore"]["getState"]>>) as unknown as ReturnType<SocialRuntime["useConnectionsStore"]["getState"]>,
  );
  const setup = create(() => ({ status: { current_user: user } }));
  const events = new EventTarget();
  const runtime: SocialRuntime = {
    events,
    api,
    useSpacesStore: store,
    useAuth: (() => ({ user, transitioning: false })) as SocialRuntime["useAuth"],
    useSetupStore: setup as unknown as SocialRuntime["useSetupStore"],
    useConnectionsStore: connections,
    Picker: (props) => <MistyPickerShell {...props} FilePickerComponent={library.runtime.Picker} />,
    Error: library.runtime.Error,
    useAiSurfaceAdapter: library.runtime.useAiSurfaceAdapter,
    useWorkspaceTabTitle: library.runtime.useWorkspaceTabTitle,
    useSpaceChatDraft: useSdkSpaceChatDraft,
    queueMobileChatSubmission: async () => {
      throw new Error("Reconnect before sending this message.");
    },
    openProviderAuthorizationLink: async (url) => {
      await misty.links.openExternal(url);
      return { strategy: "system-browser", platform: "desktop", attemptedAt: Date.now() };
    },
  };
  const release = configureSocialRuntime(runtime);
  const unsubscribe = await misty.social.subscribe(({ name, detail }) => {
    if (signal.aborted) return;
    if (name === "presence") {
      store.setState({
        presenceBySpace: { [spaceId]: detail as Store["presenceBySpace"][string] },
      });
      return;
    }
    events.dispatchEvent(new CustomEvent(name, { detail }));
    if (name === "misty:space-message-event") {
      const value = detail as {
        conversationId?: string;
        event?: Parameters<typeof messageFromSpaceEvent>[0];
      };
      if (!value.conversationId) {
        const message = value.event ? messageFromSpaceEvent(value.event) : undefined;
        if (message) merge([message]);
        else void store.getState().loadMessages(spaceId).catch(report);
      }
    }
  });
  // Conversation hooks also consume the host's scoped Space events. Refresh lists on
  // focus so a suspended/downloaded view catches up after reconnecting.
  const refresh = () => {
    if (!signal.aborted) {
      void store.getState().loadMembers(spaceId).catch(report);
      void store.getState().loadChatAgents(spaceId).catch(report);
      void store.getState().loadMessages(spaceId).catch(report);
      void connections.getState().load();
      void api
        .nodes(spaceId)
        .then((result) => {
          if (!signal.aborted) store.setState({ nodesBySpace: { [spaceId]: result.nodes ?? [] } });
        })
        .catch(report);
    }
  };
  window.addEventListener("focus", refresh);
  refresh();
  return {
    spaceId,
    spaceName: identity.space.name ?? "Space",
    update(next: MistyComponentContext) {
      library.update(next);
    },
    close() {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      release();
      library.close();
    },
  };
}

function wireArgs(args: unknown[]) {
  const values = [...args];
  while (values.length && values[values.length - 1] === undefined) values.pop();
  return JSON.parse(JSON.stringify(values));
}
