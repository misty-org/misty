import { MockTelemetryClient } from "@/telemetry/client";
import { TelemetryIdentityManager } from "@/telemetry/identity";
import { describe, expect, it } from "vitest";

describe("telemetry identity", () => {
  it("identifies restored/login users once and resets on logout", () => {
    const client = new MockTelemetryClient();
    const identity = new TelemetryIdentityManager(client);
    identity.sync({ id: "opaque-user-id", accountCreatedAt: "2026-01-01", currentPlan: "pro" });
    identity.sync({ id: "opaque-user-id" });
    expect(client.identifiedUserId).toBe("opaque-user-id");
    identity.sync(null);
    expect(client.identifiedUserId).toBeNull();
    expect(client.resetCount).toBe(1);
  });
});
