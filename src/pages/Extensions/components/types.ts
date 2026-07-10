export type PluginBrowserTab = "marketplace" | "installed";

export type PluginBrowserEntry = {
  id: string;
  name: string;
  version: string;
  author: string;
  overview: string;
  installed: boolean;
  enabled: boolean;
  verified: boolean;
  logoSrc?: string;
};
