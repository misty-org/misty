import { describe, expect, it } from "vitest";
import {
  MistyCapabilityProviderSchema,
  MistyCommunicationReadResultSchema,
  MistyCommunicationSendInputSchema,
  MistyCommunicationSendResultSchema,
  mistyInboxCapabilities,
  mistySocialCapabilities,
} from "@misty/contracts";

describe("communication capability conformance", () => {
  it("pins the same semantic Inbox contracts across browser and backend providers", () => {
    const gmail = MistyCapabilityProviderSchema.parse({
      id: "example.mail/gmail",
      version: 1,
      label: "Gmail",
      route: { kind: "browser", origins: ["https://mail.google.com"] },
      capabilities: mistyInboxCapabilities,
    });
    const outlook = MistyCapabilityProviderSchema.parse({
      id: "example.mail/outlook",
      version: 1,
      label: "Outlook",
      route: { kind: "browser", origins: ["https://outlook.live.com"] },
      capabilities: mistyInboxCapabilities,
    });
    const backend = MistyCapabilityProviderSchema.parse({
      id: "example.mail/backend",
      version: 1,
      label: "Mail backend",
      route: {
        kind: "backend",
        connectionId: "11111111-1111-4111-8111-111111111111",
      },
      capabilities: mistyInboxCapabilities,
    });
    expect(gmail.capabilities).toEqual(outlook.capabilities);
    expect(backend.capabilities).toEqual(gmail.capabilities);
    expect(
      mistySocialCapabilities.map((capability) => capability.name),
    ).toEqual([
      "social.read_thread",
      "social.search",
      "social.draft_message",
      "social.send_message",
    ]);
  });
  it("requires observed source and coverage, and refuses a clicked-send claim", () => {
    expect(
      MistyCommunicationReadResultSchema.safeParse({
        messages: [],
        partial: false,
        truncated: false,
      }).success,
    ).toBe(false);
    expect(
      MistyCommunicationSendResultSchema.safeParse({
        clicked: true,
        delivered: true,
      }).success,
    ).toBe(false);
    expect(
      MistyCommunicationSendInputSchema.safeParse({
        draftReference: "draft-one",
        recipients: [{ address: "alex@example.com" }],
      }).success,
    ).toBe(false);
    const send = mistyInboxCapabilities.find(
      (capability) => capability.name === "inbox.send",
    )!;
    expect(send.effects).toMatchObject({
      kind: "send",
      approval: "scoped",
      retry: "reconcile",
    });
  });
});
