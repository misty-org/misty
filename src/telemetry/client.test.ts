import {
  MockTelemetryClient,
  NoopTelemetryClient,
  PostHogTelemetryClient,
} from "@/telemetry/client";
import { describe, expect, it } from "vitest";

describe("telemetry clients", () => {
  it("initializes only once and remains non-remote in tests", async () => {
    const client = new PostHogTelemetryClient();
    const first = client.initialize();
    const second = client.initialize();
    expect(first).toBe(second);
    await expect(first).resolves.toBeUndefined();
  });

  it("the no-op client is disabled without configuration", () => {
    const client = new NoopTelemetryClient();
    expect(client.isAnalyticsEnabled()).toBe(false);
    expect(client.isErrorReportingEnabled()).toBe(false);
    expect(() => client.captureException(new Error("safe"))).not.toThrow();
  });

  it("opt-outs independently suppress events and exceptions", () => {
    const client = new MockTelemetryClient();
    client.setAnalyticsEnabled(false);
    client.setErrorReportingEnabled(true);
    client.captureException(new Error("failure"));
    expect(client.errors).toHaveLength(1);
    expect(client.events).toHaveLength(0);
    client.setErrorReportingEnabled(false);
    client.captureException(new Error("ignored"));
    expect(client.errors).toHaveLength(1);
  });
});
