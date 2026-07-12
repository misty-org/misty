import { invoke } from "@tauri-apps/api/core";
import { analytics } from "./client";
import { clientMetadata } from "./metadata";
import type { CommonClientProperties, TelemetryClient } from "./types";

export const ANALYTICS_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const installIdKey = "misty.analytics.install_id";
const firstOpenSentKey = "misty.analytics.first_open_sent";
const onboardingSentKey = "misty.analytics.onboarding_v1_sent";
const lastActivityKey = "misty.analytics.last_activity_ms";

export class AnalyticsLifecycleManager {
  private initialized = false;
  private authenticated = false;
  private currentSessionId = "";
  private currentSessionSent = false;
  private lastActivity: number;

  constructor(
    private readonly client: TelemetryClient,
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly metadata: () => Promise<CommonClientProperties>,
    private readonly now: () => number = Date.now,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {
    this.lastActivity = now();
    try { this.authenticated = Boolean(storage.getItem("misty_user")); } catch { this.authenticated = false; }
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.currentSessionId = this.uuid();
    void this.emitFirstOpenAndSession("process_launch");
  }

  setAuthenticationState(value: boolean): void { this.authenticated = value; }

  preferencesChanged(usageAnalytics: boolean, errorReports: boolean): void {
    this.client.setAnalyticsEnabled(usageAnalytics);
    this.client.setErrorReportingEnabled(errorReports);
    if (usageAnalytics) void this.emitFirstOpenAndSession("process_launch");
  }

  async trackOnboardingCompleted(): Promise<void> {
    if (this.read(onboardingSentKey) === "1") return;
    const metadata = await this.metadata();
    this.client.track("onboarding_completed", { ...metadata, install_id: this.installId(), onboarding_version: "1" });
    if (this.client.isAnalyticsEnabled()) this.write(onboardingSentKey, "1");
  }

  handleVisibility(hidden: boolean): void {
    if (hidden) {
      this.lastActivity = this.now();
      this.write(lastActivityKey, String(this.lastActivity));
      return;
    }
    const now = this.now();
    if (shouldStartNewSession(this.lastActivity, now)) {
      this.currentSessionId = this.uuid();
      this.currentSessionSent = false;
      void this.emitFirstOpenAndSession("returned_after_inactivity");
    }
    this.lastActivity = now;
    this.write(lastActivityKey, String(now));
  }

  private async emitFirstOpenAndSession(trigger: "process_launch" | "returned_after_inactivity"): Promise<void> {
    const metadata = await this.metadata();
    const installId = this.installId();
    if (this.read(firstOpenSentKey) !== "1") {
      this.client.track("app_first_opened", { ...metadata, install_id: installId });
      if (this.client.isAnalyticsEnabled()) this.write(firstOpenSentKey, "1");
    }
    if (!this.currentSessionSent) {
      this.client.track("app_session_started", {
        ...metadata, session_id: this.currentSessionId, install_id: installId,
        authentication_state: this.authenticated ? "authenticated" : "anonymous", session_trigger: trigger,
      });
      if (this.client.isAnalyticsEnabled()) this.currentSessionSent = true;
    }
  }

  private installId(): string {
    const existing = this.read(installIdKey);
    if (existing) return existing;
    const value = this.uuid();
    this.write(installIdKey, value);
    return value;
  }
  private read(key: string): string | null { try { return this.storage.getItem(key); } catch { return null; } }
  private write(key: string, value: string): void { try { this.storage.setItem(key, value); } catch { /* storage can be unavailable */ } }
}

export function shouldStartNewSession(lastActivity: number, now: number): boolean {
  return now - lastActivity >= ANALYTICS_SESSION_TIMEOUT_MS;
}

const lifecycle = new AnalyticsLifecycleManager(analytics, window.localStorage, clientMetadata);
let listenersInstalled = false;

export function initializeAnalyticsLifecycle(): void {
  lifecycle.initialize();
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener("visibilitychange", () => lifecycle.handleVisibility(document.visibilityState === "hidden"));
  window.addEventListener("focus", () => lifecycle.handleVisibility(false));
  window.addEventListener("beforeunload", () => { void analytics.flush(); });
  window.addEventListener("error", (event) => analytics.captureException(event.error ?? event.message, { operation: "unknown", runtime_layer: "react" }));
  window.addEventListener("unhandledrejection", (event) => analytics.captureException(event.reason, { operation: "background_task", runtime_layer: "react" }));
}

export function setAnalyticsAuthenticationState(value: boolean): void {
  lifecycle.setAuthenticationState(value);
  if (value) syncTelemetryPreferencesToServer();
}
export function telemetryPreferencesChanged(usageAnalytics: boolean, errorReports: boolean): void {
  lifecycle.preferencesChanged(usageAnalytics, errorReports);
  void invoke("telemetry_set_error_reporting_enabled", { enabled: errorReports }).catch(() => undefined);
  syncTelemetryPreferencesToServer();
}
export function trackOnboardingCompleted(): Promise<void> { return lifecycle.trackOnboardingCompleted(); }

function syncTelemetryPreferencesToServer(): void {
  void import("../pages/Account/shared/api")
    .then(({ accountUpdateTelemetryPreferences }) => accountUpdateTelemetryPreferences(analytics.isAnalyticsEnabled(), analytics.isErrorReportingEnabled()))
    .catch(() => undefined);
}
