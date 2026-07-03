export type PluginBrowserTab = "marketplace" | "installed";
export type PluginDetailTab = "overview" | "changelog" | "details";

export type PluginBrowserLink = {
  label: string;
  url: string;
};

export type PluginBrowserLauncher = {
  views: string[];
  show_in_launcher: boolean;
  requires_selected_file: boolean;
  open_mode: "inline" | "tab" | "split" | string;
};

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
  rootLabel?: string;
  capabilities: string[];
  whereItAppears: string[];
  permissions: string[];
  gettingStarted: string[];
  changelog: string[];
  links: PluginBrowserLink[];
  launcher: PluginBrowserLauncher;
};
