import type {
  AnalyticsEventName,
  DistributionChannel,
  Environment,
  Platform,
  ReleaseChannel,
} from "@/telemetry/model/types/types";

export interface CommonClientProperties {
  platform: Platform;
  os_version?: string;
  app_version: string;
  architecture?: string;
  release_channel: ReleaseChannel;
  distribution_channel: DistributionChannel;
  device_class?: "desktop" | "phone" | "tablet" | "chromeos" | "unknown";
  environment: Environment;
}

export interface CommonServerProperties {
  environment: Environment;
  server_version?: string;
}

export interface SubscriptionProperties extends CommonServerProperties {
  provider: "stripe" | "apple_app_store" | "google_play" | "revenuecat" | "other";
  plan_id: string;
  billing_interval?: "monthly" | "yearly" | "lifetime" | "other";
  currency?: string;
  amount_minor?: number;
  subscription_status: "trialing" | "active" | "past_due" | "canceled" | "expired";
}

export interface AnalyticsEventProperties {
  download_requested: {
    platform: Platform;
    architecture?: "x86_64" | "aarch64" | "universal";
    package_format?:
      "exe" | "msi" | "dmg" | "pkg" | "appimage" | "deb" | "rpm" | "app_store" | "play_store";
    app_version?: string;
    release_channel: ReleaseChannel;
    distribution_channel: DistributionChannel;
    source?: string;
    campaign?: string;
  };
  app_first_opened: CommonClientProperties & { install_id: string };
  app_session_started: CommonClientProperties & {
    session_id: string;
    install_id: string;
    authentication_state: "anonymous" | "authenticated";
    session_trigger: "process_launch" | "returned_after_inactivity";
  };
  authenticated_session_started: CommonServerProperties & { session_id: string };
  user_registered: CommonServerProperties & {
    registration_method?: "email" | "google" | "apple" | "github" | "other";
    originating_platform?: Platform;
    release_channel?: ReleaseChannel;
  };
  onboarding_completed: CommonClientProperties & { install_id: string; onboarding_version: string };
  subscription_started: SubscriptionProperties;
  subscription_renewed: SubscriptionProperties;
  subscription_canceled: SubscriptionProperties;
  subscription_expired: SubscriptionProperties;
  agent_dock_opened: {
    surface: "files" | "space";
    context_kind: "surface" | "selection" | "task";
  };
  agent_creation_completed: {
    placed_space_count: number;
    enabled_action_count: number;
    avatar_kind: "preset" | "upload";
  };
  agent_work_outcome_observed: {
    outcome: "completed" | "needs_approval" | "failed";
    source_type: string;
  };
  agent_capability_denial_observed: {
    surface: "files" | "space";
    reason_code: string;
  };
}

export interface SafeUserProperties {
  account_created_at?: string;
  current_plan?: string;
  originating_platform?: Platform;
}

export interface SafeErrorContext {
  operation?:
    | "authentication"
    | "onboarding"
    | "subscription"
    | "file_operation"
    | "application_startup"
    | "background_task"
    | "unknown";
  platform?: Platform;
  app_version?: string;
  release_channel?: ReleaseChannel;
  runtime_layer?: "react" | "rust";
  error_code?: string;
}

export interface TelemetryClient {
  initialize(): Promise<void>;
  identify(userId: string, properties?: SafeUserProperties): void;
  resetIdentity(): void;
  track<E extends AnalyticsEventName>(event: E, properties: AnalyticsEventProperties[E]): void;
  captureException(error: unknown, context?: SafeErrorContext): void;
  setAnalyticsEnabled(enabled: boolean): void;
  setErrorReportingEnabled(enabled: boolean): void;
  isAnalyticsEnabled(): boolean;
  isErrorReportingEnabled(): boolean;
  flush(): Promise<void>;
}
