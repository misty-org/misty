import { isMistyServerMethod, type MistyNavigationItem } from "@misty/sdk";
import { createAppRpcScope } from "./rpc/session";
import { createServerRpc } from "./rpc/server";
import { officialAppRuntimeRequest, type OfficialApp, type OfficialAppSession } from "@/api/apps";
import { fetchAppRuntimeResource } from "@/api/apps/runtimeResource";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { AuthUser } from "@/features/auth/authSession";
import type { WorkspaceTab } from "@/features/workspace/model";
import { grantedNativeSurface, type NativeSurfaceId } from "./nativeSurfacePolicy";

export interface AppCapabilityContext {
  signal?: AbortSignal;
  app: OfficialApp;
  session: OfficialAppSession;
  serverBase: string;
  user: AuthUser;
  space?: Space;
  tab?: WorkspaceTab;
  platform: "desktop" | "mobile";
  navigate?: (route: string) => void;
  setNavigationItems?: (items: readonly MistyNavigationItem[]) => void;
  showToast?: (message: string, tone: "neutral" | "success" | "error") => void;
  openNativeSurface?: (surface: NativeSurfaceId) => void;
}

export class AppCapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppCapabilityError";
  }
}

export async function executeAppCapability(
  context: AppCapabilityContext,
  method: string,
  params: unknown,
): Promise<unknown> {
  context.signal?.throwIfAborted();
  if (
    context.session.app_id !== context.app.id ||
    (context.space && context.session.space_id !== context.space.id)
  ) {
    throw new AppCapabilityError(
      "session_mismatch",
      "The App session does not match this App and Space.",
    );
  }
  const expiry = Date.parse(context.session.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new AppCapabilityError(
      "session_expired",
      "The App session has expired. Reopen the App to continue.",
    );
  }
  const input = record(params);
  if (method === "native.surface.open") {
    const id = grantedNativeSurface(context.app, context.session);
    if (!id)
      throw new AppCapabilityError(
        "capability_denied",
        "This App does not have access to that native service.",
      );
    if (!context.openNativeSurface || !context.tab || context.tab.groupKey !== `app:${id}`) {
      throw new AppCapabilityError(
        "unsupported_platform",
        "Open this App in the Misty native application to use device features.",
      );
    }
    context.openNativeSurface(id);
    return { surface: id };
  }
  if (method === "context.get") {
    return {
      appId: context.app.app_id ?? `com.misty.${context.app.id}`,
      slug: context.app.slug ?? context.app.id,
      version: context.app.version,
      platform: context.platform === "mobile" ? "ios" : "desktop",
      user: { id: context.user.id },
      space:
        context.space &&
        context.app.scopes.includes("spaces.read") &&
        context.session.scopes.includes("spaces.read")
          ? { id: context.space.id, name: context.space.name }
          : undefined,
    };
  }
  if (isMistyServerMethod(method)) return namedServerRequest(context, method, params);
  if (method === "official.http") return officialHttpRequest(context, params);
  authorizeCapability(context, method);
  if (method.startsWith("storage.local.")) {
    return localStorageOperation(context, method.slice("storage.local.".length), input);
  }
  if (method.startsWith("storage.sync.")) {
    return syncedStorageOperation(context, method.slice("storage.sync.".length), input);
  }
  if (method === "navigation.setItems") {
    const items = sanitizeNavigationItems(
      input.items,
      context.app.slug ?? context.app.id,
      context.session.space_id,
    );
    if (context.setNavigationItems) context.setNavigationItems(items);
    else
      window.dispatchEvent(
        new CustomEvent("misty:app-navigation", { detail: { appId: context.app.id, items } }),
      );
    return undefined;
  }
  if (method === "navigation.open") {
    const route = appOwnedRoute(
      input.route,
      context.app.slug ?? context.app.id,
      context.session.space_id,
    );
    if (context.navigate) context.navigate(route);
    else {
      window.dispatchEvent(
        new CustomEvent("misty:app-navigate", { detail: { appId: context.app.id, route } }),
      );
    }
    return undefined;
  }
  if (method === "ui.toast") {
    const message = boundedString(input.message, 500);
    const tone = ["neutral", "success", "error"].includes(String(input.tone))
      ? input.tone
      : "neutral";
    if (context.showToast) {
      context.showToast(message, tone as "neutral" | "success" | "error");
    } else {
      window.dispatchEvent(new CustomEvent("misty:app-toast", { detail: { message, tone } }));
    }
    return undefined;
  }
  throw new AppCapabilityError(
    "unsupported_method",
    "This version of Misty does not support that App capability.",
  );
}

/** Compatibility native WebViews use the same named-method server dispatcher as components. */
async function namedServerRequest(context: AppCapabilityContext, method: string, params: unknown) {
  const scope = createAppRpcScope({
    identity: {
      appId: context.app.id,
      accountId: context.user.id,
      spaceId: context.session.space_id,
      instanceId: context.tab?.id ?? "native-app-request",
    },
    scopes: context.session.scopes.filter((scope) => context.app.scopes.includes(scope)),
    expiresAt: context.session.expires_at,
    isCurrentAccount: () => !context.signal?.aborted,
  });
  const rpc = createServerRpc(scope, {
    serverBase: context.serverBase,
    readAppSession: () => ({
      appId: context.session.app_id,
      spaceId: context.session.space_id,
      token: context.session.token,
    }),
  });
  const close = () => scope.close();
  context.signal?.addEventListener("abort", close, { once: true });
  if (context.signal?.aborted) close();
  try {
    return await rpc.request({ method, params });
  } finally {
    context.signal?.removeEventListener("abort", close);
    scope.close();
  }
}

async function officialHttpRequest(context: AppCapabilityContext, params: unknown) {
  if (!context.app.official) {
    throw new AppCapabilityError(
      "capability_denied",
      "This capability is reserved for Misty Apps.",
    );
  }
  const input = record(params) as {
    path?: unknown;
    method?: unknown;
    headers?: unknown;
    body?: unknown;
  };
  const path = boundedString(input.path, 8_192);
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new AppCapabilityError("invalid_request", "The App request path is invalid.");
  }
  const method = String(input.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new AppCapabilityError("invalid_request", "The App request method is not allowed.");
  }
  const base = new URL(
    context.serverBase.endsWith("/") ? context.serverBase : `${context.serverBase}/`,
  );
  const target = new URL(path.replace(/^\/+/, ""), base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
    throw new AppCapabilityError(
      "capability_denied",
      "The App request left the Misty API boundary.",
    );
  }
  const headers = new Headers();
  if (Array.isArray(input.headers)) {
    for (const pair of input.headers.slice(0, 80)) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [name, value] = pair;
      if (typeof name !== "string" || typeof value !== "string" || value.length > 16_384) continue;
      if (["authorization", "cookie", "host", "origin", "referer"].includes(name.toLowerCase()))
        continue;
      headers.append(name, value);
    }
  }
  headers.set("Authorization", `Bearer ${context.session.token}`);
  const body = input.body instanceof ArrayBuffer ? input.body : undefined;
  return fetchAppRuntimeResource(target, {
    signal: context.signal,
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    credentials: "omit",
  });
}

/**
 * Catalog scopes are the App's declaration; session scopes are the grants
 * issued by the server for this user. Both must allow a privileged request.
 */
function authorizeCapability(context: AppCapabilityContext, method: string) {
  const capability = capabilityForMethod(method);
  if (!capability) {
    throw new AppCapabilityError(
      "unsupported_method",
      "This version of Misty does not support that App capability.",
    );
  }
  if (!context.app.scopes.includes(capability)) {
    throw new AppCapabilityError(
      "capability_undeclared",
      `The App did not declare the ${capability} capability.`,
    );
  }
  if (!context.session.scopes.includes(capability)) {
    throw new AppCapabilityError(
      "capability_denied",
      `The ${capability} capability has not been granted.`,
    );
  }
}

function capabilityForMethod(method: string): string | null {
  if (method === "storage.local.get" || method === "storage.local.keys") return "storage.read";
  if (method === "storage.local.set" || method === "storage.local.delete") return "storage.write";
  if (method === "storage.sync.get" || method === "storage.sync.keys") return "storage.read";
  if (method === "storage.sync.set" || method === "storage.sync.delete") return "storage.write";
  if (method === "navigation.setItems" || method === "navigation.open") return "navigation.write";
  if (method === "ui.toast") return "ui.toast";
  return null;
}

function localStorageOperation(
  context: AppCapabilityContext,
  operation: string,
  input: Record<string, unknown>,
) {
  // Account IDs are only unique within a deployment. Never reuse another server's data.
  const deployment = new URL(context.serverBase);
  deployment.search = "";
  deployment.hash = "";
  const prefix = `misty:app:v2:${encodeURIComponent(deployment.href.replace(/\/+$/, ""))}:${encodeURIComponent(context.user.id)}:${encodeURIComponent(context.app.app_id ?? context.app.id)}:`;
  if (operation === "keys") {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }
  const key = storageKey(input.key);
  const namespaced = `${prefix}${key}`;
  if (operation === "get") {
    const value = localStorage.getItem(namespaced);
    return value == null ? null : JSON.parse(value);
  }
  if (operation === "set") {
    const value = JSON.stringify(input.value);
    if (value.length > 256 * 1024)
      throw new AppCapabilityError("value_too_large", "App storage values are limited to 256 KB.");
    localStorage.setItem(namespaced, value);
    return undefined;
  }
  if (operation === "delete") {
    localStorage.removeItem(namespaced);
    return undefined;
  }
  throw new AppCapabilityError("unsupported_method", "Unknown App storage operation.");
}

async function syncedStorageOperation(
  context: AppCapabilityContext,
  operation: string,
  input: Record<string, unknown>,
) {
  if (operation === "keys") {
    const response = await runtimeRequest(context, "/app-runtime/records", "GET");
    const data = record(response);
    return Array.isArray(data.records)
      ? data.records.flatMap((item) => {
          const key = record(item).key;
          return typeof key === "string" ? [key] : [];
        })
      : [];
  }
  const key = storageKey(input.key);
  if (operation === "get") {
    const response = await runtimeRequest(context, "/app-runtime/records", "GET");
    const records = record(response).records;
    if (!Array.isArray(records)) return null;
    return record(records.find((item) => record(item).key === key)).data ?? null;
  }
  if (operation === "set") {
    await runtimeRequest(
      context,
      `/app-runtime/records/${encodeURIComponent(key)}`,
      "PUT",
      JSON.stringify({ data: input.value }),
    );
    return undefined;
  }
  if (operation === "delete") {
    await runtimeRequest(context, `/app-runtime/records/${encodeURIComponent(key)}`, "DELETE");
    return undefined;
  }
  throw new AppCapabilityError("unsupported_method", "Unknown App storage operation.");
}

async function runtimeRequest(
  context: AppCapabilityContext,
  path: string,
  method: string,
  body?: string,
) {
  const response = await officialAppRuntimeRequest({
    appRuntimeBase: `${context.serverBase}/app-runtime`,
    path,
    token: context.session.token,
    signal: context.signal,
    method,
    body,
  });
  if (!response.ok)
    throw new AppCapabilityError(
      "request_failed",
      `Misty denied the App request (${response.status}).`,
    );
  return response.data;
}

function sanitizeNavigationItems(
  value: unknown,
  slug: string,
  spaceId: string | undefined,
  depth = 0,
): MistyNavigationItem[] {
  if (!Array.isArray(value) || value.length > 40 || depth > 2) {
    throw new AppCapabilityError("invalid_navigation", "The App navigation tree is invalid.");
  }
  const ids = new Set<string>();
  return value.map((item) => {
    const candidate = record(item);
    const id = boundedString(candidate.id, 80);
    if (ids.has(id))
      throw new AppCapabilityError(
        "invalid_navigation",
        "App navigation IDs must be unique within a group.",
      );
    ids.add(id);
    const label = boundedString(candidate.label, 80);
    const route = appOwnedRoute(candidate.route, slug, spaceId);
    return {
      id,
      label,
      route,
      ...(candidate.children == null
        ? {}
        : { children: sanitizeNavigationItems(candidate.children, slug, spaceId, depth + 1) }),
    };
  });
}

export function appOwnedRoute(value: unknown, slug: string, spaceId: string | undefined) {
  const route = boundedString(value, 2_048);
  const parsed = new URL(route, "https://misty.local");
  const prefix = `/apps/${encodeURIComponent(slug)}`;
  if (
    parsed.origin !== "https://misty.local" ||
    (parsed.pathname !== prefix && !parsed.pathname.startsWith(`${prefix}/`))
  ) {
    throw new AppCapabilityError(
      "invalid_navigation",
      "Apps can navigate only within their own routes.",
    );
  }
  if (parsed.searchParams.getAll("space").some((id) => id !== spaceId)) {
    throw new AppCapabilityError(
      "invalid_navigation",
      "App navigation must stay in its current Space.",
    );
  }
  // An omitted Space must not fall back to whichever Space the host most recently selected.
  if (spaceId) parsed.searchParams.set("space", spaceId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function storageKey(value: unknown) {
  const key = boundedString(value, 160);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(key)) {
    throw new AppCapabilityError("invalid_key", "The App storage key is invalid.");
  }
  return key;
}

function boundedString(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AppCapabilityError("invalid_request", "The App request contains an invalid value.");
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
