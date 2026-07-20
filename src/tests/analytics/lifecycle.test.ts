import { describe, expect, it } from "vitest";
import { MockTelemetryClient } from "@/analytics/client";
import { ANALYTICS_SESSION_TIMEOUT_MS, AnalyticsLifecycleManager } from "@/analytics/lifecycle";
import type { CommonClientProperties } from "@/models/interfaces/analytics/types";

const metadata: CommonClientProperties = {
  platform: "macos",
  app_version: "1.0.0",
  release_channel: "private_beta",
  distribution_channel: "direct",
  device_class: "desktop",
  environment: "production",
};

function harness() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const client = new MockTelemetryClient();
  client.setAnalyticsEnabled(true);
  let time = 1_000;
  let id = 0;
  const manager = new AnalyticsLifecycleManager(
    client,
    storage,
    async () => metadata,
    () => time,
    () => `uuid-${++id}`,
  );
  return {
    client,
    manager,
    values,
    setTime: (value: number) => {
      time = value;
    },
  };
}

describe("analytics lifecycle", () => {
  it("initializes once and emits first open and one process session", async () => {
    const { client, manager } = harness();
    manager.initialize();
    manager.initialize();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.events.filter((item) => item.event === "app_first_opened")).toHaveLength(1);
    expect(client.events.filter((item) => item.event === "app_session_started")).toHaveLength(1);
  });

  it("deduplicates focus within 30 minutes and starts a session at the timeout", async () => {
    const { client, manager, setTime } = harness();
    manager.initialize();
    await Promise.resolve();
    await Promise.resolve();
    setTime(2_000);
    manager.handleVisibility(false);
    await Promise.resolve();
    expect(client.events.filter((item) => item.event === "app_session_started")).toHaveLength(1);
    setTime(2_000 + ANALYTICS_SESSION_TIMEOUT_MS);
    manager.handleVisibility(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(client.events.filter((item) => item.event === "app_session_started")).toHaveLength(2);
  });

  it("keeps analytics and error consent independent", () => {
    const { client, manager } = harness();
    manager.preferencesChanged(false, true);
    expect(client.isAnalyticsEnabled()).toBe(false);
    expect(client.isErrorReportingEnabled()).toBe(true);
    manager.preferencesChanged(true, false);
    expect(client.isAnalyticsEnabled()).toBe(true);
    expect(client.isErrorReportingEnabled()).toBe(false);
  });

  it("marks onboarding only once", async () => {
    const { client, manager } = harness();
    await manager.trackOnboardingCompleted();
    await manager.trackOnboardingCompleted();
    expect(client.events.filter((item) => item.event === "onboarding_completed")).toHaveLength(1);
  });
});
