// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { invoke } from "@/native/invoke";

export interface ProxySettings {
  enabled: boolean;
  url: string | null;
}

export const proxyApi = {
  get: () => invoke<ProxySettings>("engine_proxy_get"),
  /** Saves and returns what was saved; refuses a URL that isn't http, https or socks5. */
  set: (enabled: boolean, url: string | null) =>
    invoke<ProxySettings>("engine_proxy_set", { enabled, url }),
};
