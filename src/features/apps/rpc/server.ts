import { httpRequest } from "@/api/client/http";
import {
  mistyServerMethods,
  AppRpcErrorSchema,
  parseAppRpcRequest,
  parseMethodParams,
  type MistyServerMethod,
} from "@misty/sdk";
import { AppRpcError, rpcString, type AppRpcScope } from "./session";

/** Server credentials belong to the host session, never to SDK component props. */
export function createServerRpc(
  scope: AppRpcScope,
  options: {
    serverBase: string;
    readAppSession: () => { appId: string; spaceId?: string; token: string };
    fetch?: typeof fetch;
  },
) {
  const pending = new Set<AbortController>();
  let closed = false;
  const base = new URL(
    options.serverBase.endsWith("/") ? options.serverBase : `${options.serverBase}/`,
  );
  if (!["http:", "https:"].includes(base.protocol))
    throw new AppRpcError("invalid_server", "Invalid Misty server address.");
  const endpoint = new URL("app-runtime/rpc", base);
  const runtime = {
    async request(
      message: { method: string; params?: unknown },
      requestOptions?: { signal?: AbortSignal; journalUploadToken?: string },
    ): Promise<unknown> {
      scope.assert();
      if (closed) throw new AppRpcError("app_closed", "The server RPC runtime has closed.");
      const method = rpcString(message.method, 120);
      if (!Object.prototype.hasOwnProperty.call(mistyServerMethods, method))
        throw new AppRpcError("unsupported_method", "Unknown Misty server method.");
      const params = parseMethodParams(method as MistyServerMethod, message.params);
      const uploadToken = requestOptions?.journalUploadToken;
      if (
        uploadToken !== undefined &&
        (!["notes.assets.finalize", "drawings.assets.finalize"].includes(method) ||
          typeof uploadToken !== "string" ||
          !/^[\x21-\x2b\x2d-\x7e]{1,1024}$/.test(uploadToken))
      )
        throw new AppRpcError("invalid_upload_credential", "Invalid Journal upload credential.");
      if (["notes.assets.finalize", "drawings.assets.finalize"].includes(method) && !uploadToken)
        throw new AppRpcError(
          "upload_credential_required",
          "Journal finalization requires its upload credential.",
        );
      parseAppRpcRequest({ protocol: 2, method, params }, scope.identity.spaceId ?? "");
      const session = options.readAppSession();
      if (
        session.appId !== scope.identity.appId ||
        (session.spaceId ?? "") !== (scope.identity.spaceId ?? "")
      )
        throw new AppRpcError(
          "session_mismatch",
          "The server session does not match this App instance.",
        );
      if (!session.token)
        throw new AppRpcError("session_required", "The server App session is unavailable.");
      const controller = new AbortController();
      const cancel = () => controller.abort(requestOptions?.signal?.reason);
      if (requestOptions?.signal?.aborted) cancel();
      else requestOptions?.signal?.addEventListener("abort", cancel, { once: true });
      const assertActive = () => {
        scope.assert();
        if (controller.signal.aborted)
          throw new AppRpcError("request_cancelled", "The server request was cancelled.");
        if (closed) throw new AppRpcError("app_closed", "The server RPC runtime has closed.");
      };
      pending.add(controller);
      try {
        assertActive();
        const response = await (options.fetch ?? httpRequest)(endpoint, {
          method: "POST",
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
            ...(uploadToken ? { "X-Misty-Library-Upload-Token": uploadToken } : {}),
          },
          body: JSON.stringify({ protocol: 2, method: method as MistyServerMethod, params }),
        });
        assertActive();
        if (!response.ok) {
          const raw = await response.text();
          let error: { code?: string; message?: string } = {};
          try {
            const parsed = AppRpcErrorSchema.safeParse(JSON.parse(raw));
            if (parsed.success) error = parsed.data;
          } catch {
            /* Preserve a useful bounded server error. */
          }
          throw new AppRpcError(
            error.code ?? "server_error",
            error.message ?? `Misty denied the method (${response.status}).`,
          );
        }
        if (response.status === 204) return undefined;
        const result: unknown = await response.json();
        assertActive();
        return result;
      } finally {
        pending.delete(controller);
        requestOptions?.signal?.removeEventListener("abort", cancel);
      }
    },
    close() {
      closed = true;
      pending.forEach((controller) => controller.abort());
      pending.clear();
    },
  };
  scope.signal.addEventListener("abort", runtime.close, { once: true });
  if (scope.signal.aborted) runtime.close();
  return runtime;
}
