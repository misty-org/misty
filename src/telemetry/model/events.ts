import type {
  AnalyticsEventName,
  DistributionChannel,
  Environment,
  Platform,
  ReleaseChannel,
} from "@/telemetry/model/environment";

export interface CommonClientProperties {
  platform: Platform;
  os_version?: string;
  app_version: string;
  architecture?: string;
  release_channel: ReleaseChannel;
  distribution_channel: DistributionChannel;
  device_class?: "desktop" | "unknown";
  environment: Environment;
}

interface CommonServerProperties {
  environment: Environment;
  server_version?: string;
}

export interface AnalyticsEventProperties {
  app_first_opened: CommonClientProperties & { install_id: string };
  app_session_started: CommonClientProperties & {
    session_id: string;
    install_id: string;
    authentication_state: "anonymous" | "authenticated";
    session_trigger: "process_launch" | "returned_after_inactivity";
  };
  user_registered: CommonServerProperties & {
    registration_method?: "email" | "google" | "apple" | "github" | "other";
    originating_platform?: Platform;
    release_channel?: ReleaseChannel;
  };
  onboarding_completed: CommonClientProperties & { install_id: string; onboarding_version: string };
  ai_companion_dismissed: {
    surface: string;
    had_task: boolean;
  };
  ai_companion_artifact_decided: {
    surface: string;
    artifact_kind: string;
    decision: "accept" | "reject" | "refine";
  };
  ai_companion_direct_effect: { surface: string; artifact_kind: string };
  ai_companion_undo: { surface: string };
}

export interface SafeUserProperties {
  account_created_at?: string;
  originating_platform?: Platform;
}

export interface SafeErrorContext {
  operation?:
    | "authentication"
    | "onboarding"
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
  /** Nothing is sent while nobody is signed in, whatever the preferences say. */
  setAccountPresent(present: boolean): void;
  flush(): Promise<void>;
}
