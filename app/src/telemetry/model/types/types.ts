import type { AnalyticsEventProperties } from "@/telemetry/model/interfaces/types";

export type Platform = "windows" | "macos" | "linux" | "android" | "ios";

export type Environment = "development" | "test" | "staging" | "production";

export type ReleaseChannel =
  "development" | "internal" | "private_alpha" | "private_beta" | "public_beta" | "production";

export type DistributionChannel =
  | "direct"
  | "microsoft_store"
  | "mac_app_store"
  | "apple_app_store"
  | "google_play"
  | "linux_package"
  | "unknown";

export type AnalyticsEventName = keyof AnalyticsEventProperties;
