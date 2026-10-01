import type {
  AnalyticsEventProperties,
  SafeErrorContext,
  SafeUserProperties,
  TelemetryClient,
} from "@/telemetry/model/interfaces/types";
import type { AnalyticsEventName } from "@/telemetry/model/types/types";
import posthog, { type PostHog } from "posthog-js";
import { clientMetadata } from "./metadata";
import { redactRecord, redactedError } from "./redaction";

export const TELEMETRY_DEFAULTS = Object.freeze({
  analyticsEnabled: false,
  errorReportingEnabled: false,
});
const analyticsPreferenceKey = "misty.telemetry.analytics.enabled";
const errorPreferenceKey = "misty.telemetry.errors.enabled";
const remoteChannels = new Set([
  "internal",
  "private_alpha",
  "private_beta",
  "public_beta",
  "production",
]);

export class PostHogTelemetryClient implements TelemetryClient {
  private instance: PostHog | null = null;
  private initialization: Promise<void> | null = null;
  private analyticsEnabled = readBoolean(
    analyticsPreferenceKey,
    TELEMETRY_DEFAULTS.analyticsEnabled,
  );
  private errorEnabled = readBoolean(errorPreferenceKey, TELEMETRY_DEFAULTS.errorReportingEnabled);
  private pendingIdentity: { userId: string; properties: SafeUserProperties } | null = null;
  // Identity and repeated errors are sent once: re-applying settings or an
  // error thrown in a loop must not resend the same payload.
  private identifiedKey = "";
  private recentErrors = new Map<string, number>();

  initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    const metadata = await clientMetadata();
    const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
    const host = import.meta.env.VITE_POSTHOG_HOST?.trim();
    if (
      !token ||
      !host ||
      metadata.environment === "development" ||
      metadata.environment === "test" ||
      !remoteChannels.has(metadata.release_channel)
    )
      return;
    posthog.init(token, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      capture_dead_clicks: false,
      capture_performance: false,
      disableDeviceModel: true,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: "identified_only",
      opt_out_capturing_by_default: !(this.analyticsEnabled || this.errorEnabled),
      persistence: "localStorage",
      sanitize_properties: (properties) => redactRecord(properties),
    });
    posthog.register({ $geoip_disable: true });
    this.instance = posthog;
    this.syncOptState();
    if (this.pendingIdentity && this.analyticsEnabled) this.sendIdentity();
  }

  private sendIdentity(): void {
    const identity = this.pendingIdentity;
    if (!identity || !this.instance) return;
    const properties = redactRecord(identity.properties as Record<string, unknown>);
    const key = JSON.stringify([identity.userId, properties]);
    if (key === this.identifiedKey) return;
    this.identifiedKey = key;
    this.instance.identify(identity.userId, properties);
  }

  identify(userId: string, properties: SafeUserProperties = {}): void {
    if (!userId) return;
    this.pendingIdentity = { userId, properties };
    if (!this.analyticsEnabled) return;
    this.sendIdentity();
  }
  resetIdentity(): void {
    this.pendingIdentity = null;
    this.identifiedKey = "";
    this.instance?.reset();
  }

  track<E extends AnalyticsEventName>(event: E, properties: AnalyticsEventProperties[E]): void {
    if (!this.analyticsEnabled) return;
    if (!this.instance) return;
    this.instance.capture(event, redactRecord(properties as unknown as Record<string, unknown>));
  }

  captureException(error: unknown, context: SafeErrorContext = {}): void {
    if (!this.errorEnabled || !this.instance) return;
    const redacted = redactedError(error);
    const key = `${redacted.name}:${redacted.message}:${(redacted.stack ?? "").slice(0, 500)}`;
    const now = Date.now();
    const sentAt = this.recentErrors.get(key);
    if (sentAt !== undefined && now - sentAt < 10 * 60_000) return;
    this.recentErrors.set(key, now);
    if (this.recentErrors.size > 200) {
      for (const [entry, at] of this.recentErrors)
        if (now - at >= 10 * 60_000) this.recentErrors.delete(entry);
      if (this.recentErrors.size > 200) this.recentErrors.clear();
    }
    this.instance.captureException(redacted, {
      ...redactRecord(context as Record<string, unknown>),
      runtime_layer: "react",
    });
  }

  setAnalyticsEnabled(enabled: boolean): void {
    this.analyticsEnabled = enabled;
    writeBoolean(analyticsPreferenceKey, enabled);
    this.syncOptState();
    if (enabled) this.sendIdentity();
  }
  setErrorReportingEnabled(enabled: boolean): void {
    this.errorEnabled = enabled;
    writeBoolean(errorPreferenceKey, enabled);
    this.syncOptState();
  }
  isAnalyticsEnabled(): boolean {
    return this.analyticsEnabled;
  }
  isErrorReportingEnabled(): boolean {
    return this.errorEnabled;
  }
  async flush(): Promise<void> {
    await this.instance?.shutdown(2_000);
  }
  private syncOptState(): void {
    if (!this.instance) return;
    if (this.analyticsEnabled || this.errorEnabled) {
      this.instance.opt_in_capturing({ captureEventName: false });
    } else {
      this.instance.opt_out_capturing();
    }
  }
}

export class NoopTelemetryClient implements TelemetryClient {
  async initialize(): Promise<void> {}
  identify(_userId: string, _properties?: SafeUserProperties): void {}
  resetIdentity(): void {}
  track<E extends AnalyticsEventName>(_event: E, _properties: AnalyticsEventProperties[E]): void {}
  captureException(_error: unknown, _context?: SafeErrorContext): void {}
  setAnalyticsEnabled(_enabled: boolean): void {}
  setErrorReportingEnabled(_enabled: boolean): void {}
  isAnalyticsEnabled(): boolean {
    return false;
  }
  isErrorReportingEnabled(): boolean {
    return false;
  }
  async flush(): Promise<void> {}
}

export class DevelopmentTelemetryClient extends NoopTelemetryClient {
  private analyticsEnabled = false;
  private errorEnabled = false;
  override setAnalyticsEnabled(value: boolean): void {
    this.analyticsEnabled = value;
  }
  override setErrorReportingEnabled(value: boolean): void {
    this.errorEnabled = value;
  }
  override isAnalyticsEnabled(): boolean {
    return this.analyticsEnabled;
  }
  override isErrorReportingEnabled(): boolean {
    return this.errorEnabled;
  }
  override track<E extends AnalyticsEventName>(
    event: E,
    properties: AnalyticsEventProperties[E],
  ): void {
    if (this.analyticsEnabled)
      console.info(
        `[telemetry:${event}]`,
        redactRecord(properties as unknown as Record<string, unknown>),
      );
  }
  override captureException(error: unknown, context: SafeErrorContext = {}): void {
    if (this.errorEnabled)
      console.error(
        "[telemetry:exception]",
        redactedError(error),
        redactRecord(context as Record<string, unknown>),
      );
  }
}

export class MockTelemetryClient extends DevelopmentTelemetryClient {
  readonly events: Array<{ event: AnalyticsEventName; properties: Record<string, unknown> }> = [];
  readonly errors: Error[] = [];
  identifiedUserId: string | null = null;
  resetCount = 0;
  initializeCount = 0;
  override async initialize(): Promise<void> {
    this.initializeCount += 1;
  }
  override identify(userId: string, _properties?: SafeUserProperties): void {
    this.identifiedUserId = userId;
  }
  override resetIdentity(): void {
    this.identifiedUserId = null;
    this.resetCount += 1;
  }
  override track<E extends AnalyticsEventName>(
    event: E,
    properties: AnalyticsEventProperties[E],
  ): void {
    if (this.isAnalyticsEnabled())
      this.events.push({
        event,
        properties: redactRecord(properties as unknown as Record<string, unknown>),
      });
  }
  override captureException(error: unknown, _context?: SafeErrorContext): void {
    if (this.isErrorReportingEnabled()) this.errors.push(redactedError(error));
  }
}

function makeTelemetryClient(): TelemetryClient {
  if (import.meta.env.MODE === "test") return new NoopTelemetryClient();
  if (import.meta.env.DEV) return new DevelopmentTelemetryClient();
  return new PostHogTelemetryClient();
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}
function writeBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* in-memory state remains authoritative */
  }
}

export const analytics = makeTelemetryClient();
