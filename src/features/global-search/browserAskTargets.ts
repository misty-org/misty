import { apiRequest, assertStableApiSession, readApiSessionGeneration } from "@/api/client";
import { nativeRpcBackend } from "@/features/apps/rpc/nativeBackend";
import { providerBrowserProfile, type BrowserProviderId } from "@/features/browser/browserProviders";
import { browserRuntimeIdForScope } from "@/features/browser/browserRuntime";
import {
  MistyCapabilityTargetConfigurationSchema,
  MistyCapabilityTargetPageSchema,
  MistyCapabilityTargetSchema,
  type MistyCapabilityTarget,
  type MistyCapabilityTargetConfiguration,
  type MistyCapabilityTargetPage,
} from "@misty/contracts";
import { z } from "zod";
import type { BrowserAskSnapshot } from "./browserAskContext";

// These are shipped adapter declarations, not hostname-based certification.
// Every execution still verifies its live account, action, and exact effect.
const adapters = {
  google: { adapter: "gmail", providerId: "inbox/gmail", label: "Gmail", origins: ["https://mail.google.com"], capabilities: ["inbox.read", "inbox.draft", "inbox.send"] },
  microsoft: { adapter: "outlook", providerId: "inbox/outlook", label: "Outlook", origins: ["https://outlook.live.com", "https://outlook.office.com", "https://outlook.office365.com", "https://outlook.cloud.microsoft"], capabilities: ["inbox.read", "inbox.draft", "inbox.send"] },
  todoist: { adapter: "todoist", providerId: "planner/todoist", label: "Todoist", origins: ["https://app.todoist.com"], capabilities: ["tasks.create"] },
} as const satisfies Partial<Record<BrowserProviderId, { adapter: string; providerId: string; label: string; origins: readonly string[]; capabilities: readonly string[] }>>;

const observationSchema = z.object({
  url: z.string().url(),
  target: z.object({ scopeId: z.string(), profileId: z.string(), origin: z.string(), authentication: z.string(), trust: z.literal("host-observation") }),
  semantic: z.object({ adapter: z.string(), version: z.literal(1), account: z.string().email().max(320), thread: z.string().url().optional() }),
});

export interface BrowserAskTarget {
  target: MistyCapabilityTarget;
  account: string;
  capabilities: string[];
  threadReference?: string;
}

/** Establish identity using the host's existing read-only primitive. No model,
 * navigation, account UI mutation, or website write occurs during admission. */
export async function bindBrowserAskTarget(
  snapshot: BrowserAskSnapshot,
  accountId: string,
  deviceId: string,
  assertCurrentAccount: () => void,
): Promise<BrowserAskTarget | undefined> {
  const adapter = adapters[snapshot.providerId as keyof typeof adapters];
  if (!adapter || !snapshot.spaceId) return undefined;
  const generation = readApiSessionGeneration();
  const assertView = () => {
    assertStableApiSession(generation);
    assertCurrentAccount();
    const profile = providerBrowserProfile(snapshot.id);
    if (!profile || profile.ownerAccountId !== accountId || profile.profileId !== snapshot.profileId ||
        profile.provider.id !== snapshot.providerId || profile.originSpaceId !== snapshot.spaceId ||
        profile.scopeId !== snapshot.scopeId || browserRuntimeIdForScope(snapshot.scopeId) !== snapshot.id) {
      throw new Error("This browser account or view changed. Open Ask from the source page again.");
    }
  };
  assertView();
  const grantId = `ask-account-${crypto.randomUUID()}`;
  const agentId = "host-browser-ask";
  let raw: unknown;
  try {
    await nativeRpcBackend.invoke("browser_agent_grant_register", { request: {
      id: snapshot.id, scopeId: snapshot.scopeId, grantId, agentId,
      capabilities: ["browser.inspect"], expiresAt: new Date(Date.now() + 30_000).toISOString(),
    } });
    assertView();
    raw = await nativeRpcBackend.invoke("browser_agent_execute", { request: {
      scopeId: snapshot.scopeId, grantId, agentId, operation: "browser.inspect", input: {},
    } });
  } finally {
    await nativeRpcBackend.invoke("browser_agent_grant_revoke", { request: { id: snapshot.id, grantId } }).catch(() => undefined);
  }
  assertView();
  const parsed = observationSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Misty could not verify the signed-in account. Open the provider account details and try Ask again.");
  const page = parsed.data;
  const observedURL = new URL(page.url);
  if (page.url !== snapshot.page.url || observedURL.username || observedURL.password ||
      page.target.scopeId !== snapshot.scopeId || page.target.profileId !== snapshot.profileId ||
      page.target.origin !== observedURL.origin || page.target.authentication === "required" ||
      page.semantic.adapter !== adapter.adapter || !(adapter.origins as readonly string[]).includes(observedURL.origin)) {
    throw new Error("The source page or signed-in account changed. Open Ask from the source page again.");
  }
  const account = page.semantic.account.toLowerCase();
  let cursor: string | null | undefined;
  const records: MistyCapabilityTargetPage["targets"] = [];
  do {
    assertView();
    const result = MistyCapabilityTargetPageSchema.parse(await apiRequest<unknown>(
      `/me/sdk-targets?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ));
    records.push(...result.targets);
    cursor = result.nextCursor;
    if (cursor && records.length >= 1000) throw new Error("Choose a browser account in Misty before continuing.");
  } while (cursor);
  assertView();
  const matching = records.filter(({ target }) => target.providerId === adapter.providerId && target.spaceId === snapshot.spaceId &&
    target.binding.kind === "browser" && target.binding.profileId === snapshot.profileId && target.binding.deviceId === deviceId);
  if (matching.length > 1) throw new Error("More than one browser target matches this account. Resolve the duplicate targets before continuing.");
  const current = matching[0];
  if (current && (!current.enabled || current.target.binding.kind !== "browser" || current.target.binding.accountIdentity?.toLowerCase() !== account)) {
    throw new Error("This browser account changed or its actions were disabled. Confirm the intended account before enabling actions again.");
  }
  const binding = current?.target.binding;
  const configuration: MistyCapabilityTargetConfiguration = {
    targetId: current?.target.id ?? crypto.randomUUID(), expectedRevision: current?.target.revision ?? 0,
    providerId: adapter.providerId, providerVersion: 1, spaceId: snapshot.spaceId,
    label: `${adapter.label} · ${account}`, capabilities: [...adapter.capabilities],
    // Ask is a trusted host caller. This does not grant installed apps access.
    callerApps: current?.callerApps ?? [],
    browser: {
      kind: "browser", deviceId, profileId: snapshot.profileId!, scopeId: snapshot.scopeId,
      accountBindingId: binding?.kind === "browser" ? binding.accountBindingId : crypto.randomUUID(),
      accountIdentity: account, origins: [...adapter.origins],
    },
  };
  // Never restore a capability that the user removed from an existing target.
  if (current) configuration.capabilities = current.capabilities.filter((name) => (adapter.capabilities as readonly string[]).includes(name));
  if (!configuration.capabilities.length) throw new Error("Browser actions are disabled for this account.");
  let target = current?.target;
  const sameBinding = binding?.kind === "browser" && binding.scopeId === snapshot.scopeId &&
    binding.accountIdentity === account && binding.contextId === undefined &&
    binding.origins.length === adapter.origins.length && binding.origins.every((origin) => (adapter.origins as readonly string[]).includes(origin));
  if (!target || !sameBinding) {
    assertView();
    const response = await apiRequest<{ target: unknown }>("/me/sdk-targets", {
      method: "POST", body: JSON.stringify(MistyCapabilityTargetConfigurationSchema.parse(configuration)),
    });
    target = MistyCapabilityTargetSchema.parse(response.target);
  }
  assertView();
  if (target.providerId !== configuration.providerId || target.spaceId !== configuration.spaceId ||
      target.binding.kind !== "browser" || target.binding.profileId !== configuration.browser!.profileId ||
      target.binding.scopeId !== snapshot.scopeId || target.binding.accountIdentity?.toLowerCase() !== account ||
      target.binding.deviceId !== deviceId) throw new Error("The browser target changed during setup. Open Ask again.");
  const available: string[] = [];
  for (const capability of configuration.capabilities) {
    assertView();
    const response = z.object({ targets: z.array(z.unknown().transform((value) => MistyCapabilityTargetSchema.parse(value))) }).parse(await apiRequest<unknown>("/capabilities/targets/resolve", {
      method: "POST", body: JSON.stringify({ targetId: target.id, spaceId: snapshot.spaceId, capability }),
    }));
    if (response.targets.some((resolved) => resolved.id === target.id && resolved.revision === target.revision)) available.push(capability);
  }
  assertView();
  // A native suggestion is a shortcut into Ask, not an execution grant. The
  // menu checks fresh provider account facts; selecting it repeats admission.
  // Planner availability is resolved in the originating Space, never inferred.
  const menuCapabilities = [...available];
  if (available.includes("inbox.read")) {
    try {
      const planner = z.object({ targets: z.array(z.unknown().transform((value) => MistyCapabilityTargetSchema.parse(value))) }).parse(await apiRequest<unknown>("/capabilities/targets/resolve", {
        method: "POST", body: JSON.stringify({ spaceId: snapshot.spaceId, capability: "tasks.create" }),
      }));
      if (planner.targets.length === 1 && planner.targets[0].spaceId === snapshot.spaceId && planner.targets[0].providerId === "planner/tasks") menuCapabilities.push("tasks.create");
    } catch { /* An unavailable task destination does not disable mail actions. */ }
  }
  assertView();
  await nativeRpcBackend.invoke("browser_context_menu_availability", { request: {
    id: snapshot.id, scopeId: snapshot.scopeId, profileId: snapshot.profileId,
    spaceId: snapshot.spaceId, providerId: snapshot.providerId, account, capabilities: menuCapabilities, origins: configuration.browser!.origins,
  } });
  return { target, account, capabilities: available, threadReference: page.semantic.thread };
}
