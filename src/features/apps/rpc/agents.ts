import { isMistyAgentsMethod, mistyAgentsContracts } from "@misty/sdk";
import { createAgentsApi } from "@/api/agents/api-core";
import { createAssistantApi } from "@/api/assistant/api-core";
import { createAiSurfaceApi } from "@/features/ai-surface/api-core";
import { createAutomationsApi } from "@/features/agents/automations/api-core";
import { createMcpConnectionsApi } from "@/features/agents/mcp/api-core";
import { createMistyImageTransfers } from "@/features/global-search/mistyImageTransfers";
import { createAgentOwnedBrowserWorkspace } from "@/features/agents/agentOwnedBrowserWorkspace";
import { AppRpcError, type AppRpcScope } from "./session";
export function createAgentsRpc(
  scope: AppRpcScope,
  options: { serverBase: string; token(): string },
) {
  const root = new URL(options.serverBase.replace(/\/?$/, "/"));
  const response = async (path: string, init: RequestInit = {}) => {
    scope.assert();
    if (
      path !== "/billing/usage" &&
      !/^\/(agents|agent-runs|agent-voice|misty|ai|automations|mcp|search|me|spaces)(\/|\?|$)/.test(
        path,
      )
    )
      throw new AppRpcError("unsupported_method", "This Agents endpoint is unavailable.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${options.token()}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const result = await fetch(new URL(path.replace(/^\//, ""), root), {
      ...init,
      headers,
      credentials: "omit",
      signal: init.signal ?? scope.signal,
    });
    scope.assert();
    if (!result.ok) {
      const raw = await result.text();
      let message = raw,
        code = "agents_request_failed";
      try {
        const error = JSON.parse(raw);
        message = error.message ?? raw;
        code = error.code ?? code;
      } catch {}
      throw new AppRpcError(code, message.slice(0, 2000) || "Agents request failed.");
    }
    return result;
  };
  const request = async <T = void>(path: string, init?: RequestInit): Promise<T> => {
    const result = await response(path, init);
    const body = await result.text();
    return (body ? JSON.parse(body) : undefined) as T;
  };
  const api = {
    agents: createAgentsApi(request),
    assistant: createAssistantApi(request),
    ai: createAiSurfaceApi(request),
    automations: createAutomationsApi(request),
    mcp: createMcpConnectionsApi(request),
  };
  const images = createMistyImageTransfers(
    request,
    async (transfer, file, _generation, progress) => {
      scope.assert("ai.write");
      const target = new URL(
        /^https?:/.test(transfer.url) ? transfer.url : transfer.url.replace(/^\//, ""),
        root,
      );
      if (!["https:", "http:"].includes(target.protocol) || target.username || target.password)
        throw new Error("The upload destination is invalid.");
      const headers = new Headers(transfer.headers);
      if (target.origin === root.origin) headers.set("Authorization", `Bearer ${options.token()}`);
      const result = await fetch(target, {
        method: transfer.method ?? "PUT",
        body: file,
        headers,
        signal: scope.signal,
        credentials: "omit",
      });
      scope.assert();
      if (!result.ok) throw new Error("The image upload failed.");
      progress.onProgress?.(1);
    },
    () => 0,
  );
  return {
    async request(message: { method: string; params?: unknown }) {
      if (!isMistyAgentsMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown Agents operation.");
      const method = message.method;
      if (method === "agents.perform") {
        const input = mistyAgentsContracts[method].params.parse(message.params);
        const [domain, name] = input.operation.split(".") as [keyof typeof api, string];
        const action = (api[domain] as Record<string, (...args: unknown[]) => Promise<unknown>>)[
          name
        ];
        const value = await action(...input.args);
        scope.assert();
        return mistyAgentsContracts[method].result.parse(value);
      }
      if (method === "agents.transcribe") {
        scope.assert("agents.write");
        const input = mistyAgentsContracts[method].params.parse(message.params);
        return mistyAgentsContracts[method].result.parse(
          await api.agents.transcribeVoice(
            new Blob([input.bytes], { type: input.mimeType }),
            input.durationMs,
          ),
        );
      }
      if (method === "agents.research") {
        scope.assert("agents.write");
        scope.assert("browser.write");
        const input = mistyAgentsContracts[method].params.parse(message.params);
        const result = await createAgentOwnedBrowserWorkspace(input.prompt);
        scope.assert();
        return mistyAgentsContracts[method].result.parse(result);
      }
      if (method === "agents.deleteImage") {
        scope.assert("ai.write");
        const input = mistyAgentsContracts[method].params.parse(message.params);
        await request(`/misty/attachments/${encodeURIComponent(input.id)}`, { method: "DELETE" });
        return;
      }
      if (method === "agents.spaces") {
        scope.assert("spaces.read");
        mistyAgentsContracts[method].params.parse(message.params);
        const spaces = scope.identity.spaceId
          ? [await request(`/spaces/${encodeURIComponent(scope.identity.spaceId)}`)]
          : (await request<{ spaces: unknown[] }>("/spaces")).spaces;
        return mistyAgentsContracts[method].result.parse(spaces ?? []);
      }
      if (method === "agents.avatar") {
        scope.assert("profile.read");
        mistyAgentsContracts[method].params.parse(message.params);
        const blob = await (await response("/me/avatar")).blob();
        scope.assert();
        return mistyAgentsContracts[method].result.parse({
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type,
        });
      }
      if (method === "agents.read") {
        scope.assert("ai.read");
        const input = mistyAgentsContracts[method].params.parse(message.params);
        const blob = await (
          await response(
            `/misty/attachments/${encodeURIComponent(input.attachmentId)}/content?variant=model`,
          )
        ).blob();
        scope.assert();
        return mistyAgentsContracts[method].result.parse({
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type,
        });
      }
      scope.assert("ai.write");
      const input = mistyAgentsContracts[method].params.parse(message.params);
      const value = await images.uploadMistyImage(
        new File([input.bytes], input.name, { type: input.mimeType }),
        { conversationId: input.conversationId, scope: input.scope },
      );
      URL.revokeObjectURL(value.previewUrl);
      scope.assert();
      return mistyAgentsContracts[method].result.parse({ ...value, previewUrl: "" });
    },
    subscribe(topic: string, listener: (event: unknown) => void) {
      scope.assert("ai.read");
      const path = decodeURIComponent(topic.slice("agents:invocation:".length));
      if (!/^\/ai\/invocations\/[A-Za-z0-9_-]+\/events$/.test(path))
        throw new AppRpcError("invalid_params", "The invocation stream is invalid.");
      const controller = new AbortController();
      const close = () => controller.abort();
      scope.signal.addEventListener("abort", close, { once: true });
      void (async () => {
        const result = await response(path, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!result.body) throw new Error("The response stream is unavailable.");
        const reader = result.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        try {
          while (!controller.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
            if (buffer.length > 2 * 1024 * 1024)
              throw new Error("The response event is too large.");
            let end;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = block
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");
              if (data) {
                scope.assert();
                if (!controller.signal.aborted) listener(JSON.parse(data));
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      })()
        .catch((error) => {
          if (!controller.signal.aborted && !scope.signal.aborted)
            listener({ type: "sdk.stream.error", message: String(error).slice(0, 2000) });
        })
        .finally(() => scope.signal.removeEventListener("abort", close));
      return () => {
        scope.signal.removeEventListener("abort", close);
        close();
      };
    },
  };
}
