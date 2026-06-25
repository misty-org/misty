import { describe, expect, it, vi } from "vitest";
import {
  MistyCapabilityDefinitionSchema, MistyCapabilityProviderSchema,
  MistyCapabilityOutcomeSchema, MistyCapabilityInvocationSchema,
  MistyCapabilityJsonSchema, MistyCapabilityTargetSchema, MistyCapabilityTargetConfigurationSchema, parseAppRpcRequest,
} from "@misty/contracts";
import { createMistyAppSDK } from "@misty/sdk";

const read = {
  name: "inbox.read", version: 1, description: "Read a selected thread.",
  inputSchema: { type: "object", properties: { threadId: { type: "string" } }, required: ["threadId"], additionalProperties: false },
  outputSchema: { type: "object" }, requiredScopes: ["browser.inspect"],
  effects: { kind: "read", incidental: [], approval: "none", retry: "read_only" },
};
describe("capability boundary", () => {
  it("preserves existing opaque Space identities on a pinned target", () => {
    const target = { id: crypto.randomUUID(), revision: 1, appId: "example.habits", providerId: "example.habits/backend", providerVersion: 1, spaceId: `space_${crypto.randomUUID()}`, label: "Personal habits", binding: { kind: "backend", connectionId: crypto.randomUUID() } };
    expect(MistyCapabilityTargetSchema.parse(target).spaceId).toBe(target.spaceId);
    expect(MistyCapabilityTargetSchema.safeParse({ ...target, spaceId: "../other-space" }).success).toBe(false);
  });

  it("accepts real device IDs in trusted browser configuration without adding an app grant method", () => {
    const browser = { kind: "browser", deviceId: `device_${crypto.randomUUID()}`, profileId: "a".repeat(64), accountBindingId: crypto.randomUUID(), origins: ["https://mail.google.com"] };
    const config = { targetId: crypto.randomUUID(), expectedRevision: 0, providerId: "example.mail/browser", providerVersion: 1, label: "Personal mail", capabilities: ["inbox.read"], callerApps: [], browser };
    expect(MistyCapabilityTargetConfigurationSchema.parse(config).browser?.deviceId).toBe(browser.deviceId);
    const target = { id: config.targetId, revision: 1, appId: "example.mail", providerId: config.providerId, providerVersion: 1, label: config.label, binding: browser };
    expect(MistyCapabilityTargetSchema.safeParse(target).success).toBe(true);
    for (const change of [{ deviceId: "device_other" }, { profileId: "/Profile" }, { origins: ["https://mail.google.com", "https://mail.google.com"] }, { origins: ["https://mail.google.com/path"] }, { cookies: "secret" }]) {
      expect(MistyCapabilityTargetSchema.safeParse({ ...target, binding: { ...browser, ...change } }).success).toBe(false);
    }
    expect(MistyCapabilityOutcomeSchema.safeParse({ status: "device_required", waitId: crypto.randomUUID(), expiresAt: new Date().toISOString(), reason: "Wake the Mac", deviceId: browser.deviceId }).success).toBe(true);
    expect(() => parseAppRpcRequest({ protocol: 2, method: "capabilities.targets.configure", params: { body: config } }, "")).toThrow();
  });

  it("supports the same contract through independent browser providers", () => {
    for (const [name, origin] of [["gmail", "https://mail.google.com"], ["outlook", "https://outlook.live.com"]]) {
      const provider = MistyCapabilityProviderSchema.parse({ id: `example.mail/${name}`, version: 1, label: name, route: { kind: "browser", origins: [origin] }, capabilities: [read] });
      expect(provider.capabilities[0].name).toBe("inbox.read");
    }
  });
  it("rejects unapproved writes, duplicate contracts and injected endpoints", () => {
    expect(MistyCapabilityDefinitionSchema.safeParse({ ...read, effects: { ...read.effects, kind: "send" } }).success).toBe(false);
    expect(MistyCapabilityProviderSchema.safeParse({ id: "example.mail/gmail", version: 1, label: "Mail", route: { kind: "browser", origins: ["https://mail.google.com"], script: "steal()" }, capabilities: [read] }).success).toBe(false);
    expect(MistyCapabilityProviderSchema.safeParse({ id: "example.mail/gmail", version: 1, label: "Mail", route: { kind: "browser", origins: ["https://mail.google.com"] }, capabilities: [read, read] }).success).toBe(false);
  });
  it("does not accept missing results, success-shaped waits, or external schema references", () => {
    expect(MistyCapabilityOutcomeSchema.safeParse({ status: "success", evidence: [], partial: false }).success).toBe(false);
    expect(MistyCapabilityOutcomeSchema.safeParse({ status: "success", result: {}, evidence: [], partial: false, device_wait: true }).success).toBe(false);
    expect(MistyCapabilityJsonSchema.safeParse({ $ref: "https://outside.invalid/schema" }).success).toBe(false);
    expect(MistyCapabilityJsonSchema.safeParse(JSON.parse('{"__proto__":{}}')).success).toBe(false);
  });
  it("rejects caller-selected execution authority", () => {
    const request = { requestId: crypto.randomUUID(), capability: "inbox.read", capabilityVersion: 1, providerId: "example.mail/gmail", providerVersion: 1, targetId: crypto.randomUUID(), targetRevision: 1, input: {}, deadline: new Date().toISOString() };
    expect(MistyCapabilityInvocationSchema.safeParse(request).success).toBe(true);
    expect(MistyCapabilityInvocationSchema.safeParse({ ...request, grantIds: [crypto.randomUUID()] }).success).toBe(false);
  });
  it("supports account-scoped discovery and validates SDK replies", async () => {
    expect(parseAppRpcRequest({ protocol: 2, method: "capabilities.discover", params: { body: {} } }, "").params).toEqual({ body: { limit: 50 }, path: {} });
    const request = vi.fn().mockResolvedValue({ providers: [], nextCursor: null });
    const sdk = createMistyAppSDK({ request });
    expect(await sdk.capabilities.discover()).toEqual({ providers: [], nextCursor: null });
    expect(request).toHaveBeenCalledWith({ method: "capabilities.discover", params: { body: { limit: 50 } } });
    request.mockResolvedValueOnce({ providers: "invalid" });
    await expect(sdk.capabilities.discover()).rejects.toThrow();
  });
});
