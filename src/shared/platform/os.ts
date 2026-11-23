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

export function platform(): string {
  return published()?.platform ?? guessedPlatform();
}

export function arch(): string {
  return published()?.arch ?? "";
}

export function version(): string {
  return published()?.version ?? "";
}
