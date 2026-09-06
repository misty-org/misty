import { openExternalLink } from "@/shared/platform/openExternalLink";
import { useSpacesStore } from "@/features/spaces";
import { isMistySocialMethod, mistySocialContracts } from "@misty/sdk";
import { createSpaceChatApi } from "@/api/spaces/chat";
import { createSpaceConversationsApi } from "@/api/spaces/conversations";
import { createSpaceActionSuggestionsApi } from "@/api/spaces/action-suggestions";
import { readDownloadBlob } from "@/api/spaces/signed-download";
import type { SpaceRequest } from "@/api/spaces/types";
import { AppRpcError, type AppRpcScope } from "./session";
export function createSocialRpc(
  scope: AppRpcScope,
  options: { serverBase: string; token(): string },
) {
  const root = new URL(options.serverBase.replace(/\/?$/, "/"));
  const prefix = `/spaces/${encodeURIComponent(scope.identity.spaceId ?? "")}/`;
  const response = async (path: string, init: RequestInit = {}) => {
    scope.assert();
    if (
      !scope.identity.spaceId ||
      !(path.startsWith(prefix) || /^\/runs\/[^/]+(?:\/(?:approval|cancel|retry))?$/.test(path))
    )
      throw new AppRpcError("space_mismatch", "This Social view belongs to another Space.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${options.token()}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const result = await fetch(new URL(path.replace(/^\//, ""), root), {
      ...init,
      headers,
      credentials: "omit",
      signal: scope.signal,
    });
    scope.assert();
    if (!result.ok)
      throw new AppRpcError(
        "social_request_failed",
        (await result.text()).slice(0, 2000) || "Social request failed.",
      );
    return result;
  };
  const request: SpaceRequest = async (path, init) => {
    const result = await response(path, init);
    const body = await result.text();
    return body ? JSON.parse(body) : undefined;
  };
  const api = {
    ...createSpaceChatApi(request),
    ...createSpaceConversationsApi(request),
    ...createSpaceActionSuggestionsApi(request),
    nodes: (id: string) => request(`/spaces/${encodeURIComponent(id)}/nodes`),
    members: (id: string) => request(`/spaces/${encodeURIComponent(id)}/members`),
    roadmaps: (id: string) => request(`/spaces/${encodeURIComponent(id)}/roadmaps`),
  };
  return {
    async request(message: { method: string; params?: unknown }) {
      if (!isMistySocialMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown Social operation.");
      if (message.method === "social.openNode") {
        scope.assert("files.read");
        const input = mistySocialContracts[message.method].params.parse(message.params);
        if (input.spaceId !== scope.identity.spaceId)
          throw new AppRpcError("space_mismatch", "This link belongs to another Space.");
        const ticket = await request<{ url: string }>(
          prefix + `nodes/${encodeURIComponent(input.nodeId)}/resolve`,
          { method: "POST", body: JSON.stringify({ disposition: "open" }) },
        );
        scope.assert();
        const target = new URL(ticket.url.replace(/^\//, ""), root);
        if (target.origin !== root.origin) throw new Error("The link destination is invalid.");
        await openExternalLink(target.href);
        return;
      }
      if (message.method === "social.read") {
        const input = mistySocialContracts[message.method].params.parse(message.params);
        if (input.spaceId !== scope.identity.spaceId)
          throw new AppRpcError("space_mismatch", "This Social view belongs to another Space.");
        const path =
          prefix +
          (input.operation === "memberAvatar"
            ? `members/${encodeURIComponent(input.id)}/avatar`
            : `attachments/${encodeURIComponent(input.id)}/download`);
        const blob = await readDownloadBlob(await response(path));
        scope.assert();
        return mistySocialContracts[message.method].result.parse({
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type,
        });
      }
      const input = mistySocialContracts[message.method].params.parse(message.params);
      if (
        !["runDetail", "decideRun", "cancelRun", "retryRun"].includes(input.operation) &&
        input.args[0] !== scope.identity.spaceId
      )
        throw new AppRpcError("space_mismatch", "This Social view belongs to another Space.");
      if (["runDetail", "decideRun", "cancelRun", "retryRun"].includes(input.operation)) {
        const detail = await api.runDetail(String(input.args[0]));
        if (detail.run.space_id !== scope.identity.spaceId)
          throw new AppRpcError("space_mismatch", "This run belongs to another Space.");
        if (input.operation === "runDetail") return detail;
      }
      const action = api[input.operation] as (...args: unknown[]) => Promise<unknown>;
      const result = await action(...input.args);
      scope.assert();
      return mistySocialContracts[message.method].result.parse(result);
    },
    subscribe(listener: (event: unknown) => void) {
      scope.assert("messages.read");
      const names = [
        "misty:space-message-event",
        "misty:space-agent-run-event",
        "misty:space-action-suggestion-event",
      ];
      const handlers = names.map((name) => {
        const handler = (event: Event) => {
          if (scope.signal.aborted) return;
          const detail = (event as CustomEvent).detail;
          if ((detail?.spaceId ?? detail?.space_id) !== scope.identity.spaceId) return;
          scope.assert("messages.read");
          listener({ name, detail: JSON.parse(JSON.stringify(detail)) });
        };
        window.addEventListener(name, handler);
        return () => window.removeEventListener(name, handler);
      });
      let last: unknown;
      const presence = () => {
        if (scope.signal.aborted) return;
        const values = useSpacesStore.getState().presenceBySpace[scope.identity.spaceId!];
        if (values === last) return;
        last = values;
        listener({ name: "presence", detail: JSON.parse(JSON.stringify(values ?? [])) });
      };
      const unsubscribe = useSpacesStore.subscribe(presence);
      presence();
      const close = () => {
        handlers.forEach((fn) => fn());
        unsubscribe();
        scope.signal.removeEventListener("abort", close);
      };
      scope.signal.addEventListener("abort", close, { once: true });
      return close;
    },
  };
}
