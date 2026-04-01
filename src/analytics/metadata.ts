import { getVersion } from "@tauri-apps/api/app";
import { arch, platform, version } from "@tauri-apps/plugin-os";
import { isAndroidBuild, isNativeMobileBuild } from "../platform/buildTarget";
import type { CommonClientProperties, DistributionChannel, Platform, ReleaseChannel } from "./types";

let cached: Promise<CommonClientProperties> | undefined;

export function clientMetadata(): Promise<CommonClientProperties> {
  cached ??= loadMetadata();
  return cached;
}

async function loadMetadata(): Promise<CommonClientProperties> {
  const [rawPlatform, osVersion, architecture, appVersion] = await Promise.all([
    safely(platform, navigator.platform), safely(version, ""), safely(arch, ""), safely(getVersion, "0.0.0"),
  ]);
  return {
    platform: normalizePlatform(rawPlatform),
    ...(osVersion ? { os_version: osVersion } : {}),
    app_version: appVersion,
    ...(architecture ? { architecture } : {}),
    release_channel: releaseChannel(),
    distribution_channel: distributionChannel(),
    device_class: isNativeMobileBuild ? "phone" : "desktop",
    environment: appEnvironment(),
  };
}

async function safely(fn: () => string | Promise<string>, fallback: string): Promise<string> {
  try { return await fn(); } catch { return fallback; }
}

function normalizePlatform(value: string): Platform {
  if (isAndroidBuild) return "android";
  if (isNativeMobileBuild) return "ios";
  const normalized = value.toLowerCase();
  if (normalized.includes("win")) return "windows";
  if (normalized.includes("mac")) return "macos";
  return "linux";
}

function releaseChannel(): ReleaseChannel {
  const value = import.meta.env.VITE_RELEASE_CHANNEL?.trim();
  return (["development", "internal", "private_alpha", "private_beta", "public_beta", "production"] as const).includes(value as ReleaseChannel)
    ? value as ReleaseChannel : import.meta.env.DEV ? "development" : "production";
}

function distributionChannel(): DistributionChannel {
  const value = import.meta.env.VITE_DISTRIBUTION_CHANNEL?.trim();
  return (["direct", "microsoft_store", "mac_app_store", "apple_app_store", "google_play", "linux_package", "unknown"] as const).includes(value as DistributionChannel)
    ? value as DistributionChannel : "unknown";
}

function appEnvironment(): CommonClientProperties["environment"] {
  if (import.meta.env.MODE === "test") return "test";
  if (import.meta.env.DEV) return "development";
  const value = import.meta.env.VITE_APP_ENVIRONMENT?.trim();
  return value === "staging" ? "staging" : "production";
}
