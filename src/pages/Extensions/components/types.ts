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
  capabilities: string[];
  whereItAppears: string[];
  permissions: string[];
  gettingStarted: string[];
  changelog: string[];
  includedTools: Array<{ name: string; version: string }>;
  links: Array<{ label: string; url: string }>;
  placement: { views: string[]; openMode: string; requiresSelection: boolean };
};
