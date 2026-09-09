import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  agentOperations,
  type MistyAppSDK,
  type MistyComponentContext,
  type MistyAgentOperation,
} from "@misty/sdk";
import { configureAgentsRuntime, type AgentsRuntime } from "./agentsRuntime";
import { useGlobalSearchStore } from "@/features/global-search/useGlobalSearchStore";
import { replaceActiveGlobalInvocationStream } from "@/features/global-search/globalSearchStoreHelpers";
import type { MistyImageAttachment, GlobalSearchResult } from "@/features/global-search/types";
import type { AiInvocationEvent } from "@/features/ai-surface/types";

export async function createSdkAgentsRuntime(
  misty: MistyAppSDK,
  context: MistyComponentContext,
  signal: AbortSignal,
  report: (error: unknown) => void,
) {
  const identity = await misty.context.get();
  if (!identity.user?.id) throw new Error("Sign in to open Agents.");
  const assert = () => {
    if (signal.aborted) throw new Error("This Agents view is closed.");
  };
  const availableSpaces = await misty.agents.spaces();
  const spaces = create(() => ({ spaces: availableSpaces, referenceOnly: false }));
  const workspace = create(() => ({
    activeScopeKey: identity.space?.id ? `space:${identity.space.id}` : "account",
  }));
  const operation = async (name: MistyAgentOperation, args: unknown[]) => {
    assert();
    const value = await misty.agents.perform(name, wireArgs(args));
    assert();
    return value;
  };
  const domain = <
    K extends
      "agentsApi" | "assistantApi" | "aiSurfaceApi" | "automationsApi" | "mcpConnectionsApi",
  >(
    name: K,
    prefix: string,
  ) =>
    new Proxy({} as AgentsRuntime[K], {
      get: (_, key) => {
        if (prefix === "agents" && key === "transcribeVoice")
          return async (blob: Blob, duration: number) =>
            misty.agents.transcribe(await blob.arrayBuffer(), blob.type, duration);
        const name = `${prefix}.${String(key)}` as MistyAgentOperation;
        if (!agentOperations.includes(name))
          throw new Error(`Agents operation ${name} is unavailable.`);
        return (...args: unknown[]) => operation(name, args);
      },
    });
  const streams = new Set<() => void>(),
    images = new Set<string>();
  const runtime: AgentsRuntime = {
    agentsApi: domain("agentsApi", "agents"),
    assistantApi: domain("assistantApi", "assistant"),
    aiSurfaceApi: domain("aiSurfaceApi", "ai"),
    automationsApi: domain("automationsApi", "automations"),
    mcpConnectionsApi: domain("mcpConnectionsApi", "mcp"),
    useAuth: (() => ({ user: identity.user, transitioning: false })) as AgentsRuntime["useAuth"],
    useSpacesStore: spaces as unknown as AgentsRuntime["useSpacesStore"],
    useWorkspaceStore: workspace as unknown as AgentsRuntime["useWorkspaceStore"],
    useAccountAvatarUrl: (id, version) => {
      const [url, setUrl] = useState("");
      useEffect(() => {
        let live = true,
          objectUrl = "";
        if (id === identity.user!.id && version)
          void misty.agents
            .avatar()
            .then((value) => {
              if (live) {
                objectUrl = URL.createObjectURL(new Blob([value.bytes], { type: value.mimeType }));
                setUrl(objectUrl);
              }
            })
            .catch(() => undefined);
        return () => {
          live = false;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
      }, [id, version]);
      return url;
    },
    Error: (props) => (
      <div role="alert" className="px-3 py-2 text-sm text-cream">
        {props.error instanceof Error
          ? props.error.message
          : String(props.error ?? "Agents needs attention.")}
      </div>
    ),
    subscribeToAiInvocation: (path, handlers) => {
      assert();
      let closed = false;
      const unsubscribe = misty.agents.subscribeInvocation(path, (event) => {
        if (closed || signal.aborted) return;
        if (
          event &&
          typeof event === "object" &&
          "type" in event &&
          event.type === "sdk.stream.error"
        ) {
          handlers.onError(new Error(String((event as { message?: string }).message)));
          return;
        }
        handlers.onEvent(event as AiInvocationEvent);
      });
      const close = () => {
        if (closed) return;
        closed = true;
        void unsubscribe.then(remove => remove()).catch(handlers.onError);
        streams.delete(close);
      };
      streams.add(close);
      return close;
    },
    executeGlobalSearch: async (set, get, query) => {
      const requestId = get().requestId + 1;
      set({ requestId, searching: true, error: null });
      try {
        const result = await runtime.assistantApi.search<GlobalSearchResult>(
          query,
          40,
          get().filters,
        );
        assert();
        if (get().requestId === requestId)
          set({ results: result.hits, searching: false, enriched: true });
      } catch (error) {
        if (!signal.aborted && get().requestId === requestId)
          set({ searching: false, error: String(error) });
      }
    },
    executeGlobalVisualSearch: async (set, get, id, query) => {
      const requestId = get().requestId + 1;
      set({ requestId, searching: true, error: null });
      try {
        const result = await runtime.assistantApi.visualSearch<GlobalSearchResult>(id, query);
        assert();
        if (get().requestId === requestId)
          set({ results: result.hits, searching: false, enriched: true });
      } catch (error) {
        if (!signal.aborted && get().requestId === requestId)
          set({ searching: false, error: String(error) });
      }
    },
    createAgentOwnedBrowserWorkspace: async (prompt) => {
      assert();
      const result = await misty.agents.research(prompt);
      assert();
      return result as Awaited<ReturnType<AgentsRuntime["createAgentOwnedBrowserWorkspace"]>>;
    },
    uploadMistyImage: async (file, input) => {
      const result = await misty.agents.uploadImage({
        bytes: await file.arrayBuffer(),
        name: file.name,
        mimeType: file.type,
        scope: input.scope,
        conversationId: input.conversationId,
      });
      assert();
      const previewUrl = URL.createObjectURL(file);
      images.add(previewUrl);
      input.onProgress?.(1);
      return { ...(result as unknown as MistyImageAttachment), previewUrl };
    },
    deleteMistyImage: async (attachment) => {
      if (images.delete(attachment.previewUrl)) URL.revokeObjectURL(attachment.previewUrl);
      if (!attachment.id.startsWith("draft-")) await misty.agents.deleteImage(attachment.id);
    },
    readImage: async (id) => {
      const result = await misty.agents.read(id);
      assert();
      return new Blob([result.bytes], { type: result.mimeType });
    },
  };
  const release = configureAgentsRuntime(runtime);
  useGlobalSearchStore.getState().setAccount(identity.user.id);
  return {
    update(_next: MistyComponentContext) {},
    close() {
      for (const close of streams) close();
      replaceActiveGlobalInvocationStream();
      useGlobalSearchStore.getState().setAccount("");
      for (const url of images) URL.revokeObjectURL(url);
      images.clear();
      release();
    },
  };
}

function wireArgs(args: unknown[]) {
  const values = [...args];
  while (values.length && values[values.length - 1] === undefined) values.pop();
  return JSON.parse(JSON.stringify(values));
}
