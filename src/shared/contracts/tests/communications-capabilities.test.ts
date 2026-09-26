import { describe, expect, it } from "vitest";
import {
  MistyCommunicationReadResultSchema,
  MistyCommunicationSendInputSchema,
  MistyCommunicationSendResultSchema,
  mistyInboxCapabilities,
  mistySocialCapabilities,
} from "@/shared/contracts";

describe("communication capability conformance", () => {
  it("declares supported social operations", () => {
    expect(mistySocialCapabilities.map((capability) => capability.name)).toEqual([
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
    const send = mistyInboxCapabilities.find((capability) => capability.name === "inbox.send")!;
    expect(send.effects).toMatchObject({
      kind: "send",
      approval: "scoped",
      retry: "reconcile",
    });
  });
});
