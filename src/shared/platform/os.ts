/**
 * The operating system Misty runs on, as the native side publishes it before any page script runs
 * (`src-tauri/features/app/platform_info.rs`). Read synchronously, like the plugin it replaces.
 * Outside the app (tests, web previews) the browser's own hints stand in.
 */
type PlatformInfo = { platform: string; arch: string; version: string };

function published(): PlatformInfo | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { __MISTY_PLATFORM__?: PlatformInfo }).__MISTY_PLATFORM__;
}

function guessedPlatform(): string {
  const hint = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
  if (/mac/i.test(hint)) return "macos";
  if (/win/i.test(hint)) return "windows";
  return "linux";
}

/** "macos", "windows" or "linux". */
export function platform(): string {
  return published()?.platform ?? guessedPlatform();
}

/** The processor architecture, such as "aarch64" or "x86_64"; empty when unknown. */
export function arch(): string {
  return published()?.arch ?? "";
}

/** The operating system's version, such as "15.5"; empty when unknown. */
export function version(): string {
  return published()?.version ?? "";
}
