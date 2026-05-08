import { platform, version } from "@tauri-apps/plugin-os";

export function browserUserAgent(): string | undefined {
  try {
    return safariCompatibleUserAgent(navigator.userAgent, platform(), version());
  } catch {
    return undefined;
  }
}

export function safariCompatibleUserAgent(
  defaultUserAgent: string,
  osPlatform: string,
  osVersion: string,
): string | undefined {
  if (osPlatform !== "macos") return undefined;
  const base = defaultUserAgent.trim();
  if (/\bVersion\/[\d.]+.*\bSafari\/[\d.]+/.test(base)) return base;

  const osMajor = Number.parseInt(osVersion, 10);
  const safariMajor = Number.isFinite(osMajor)
    ? osMajor >= 26
      ? osMajor
      : Math.max(15, osMajor + 3)
    : 18;
  const webKitVersion = base.match(/AppleWebKit\/([\d.]+)/)?.[1] ?? "605.1.15";
  // WKWebView's application UA can contain product tokens that cause sites to
  // select an incomplete embedded-browser response. Use Safari's canonical
  // token order while retaining the actual installed WebKit build number.
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/${webKitVersion} (KHTML, like Gecko) Version/${safariMajor}.0 Safari/${webKitVersion}`;
}
