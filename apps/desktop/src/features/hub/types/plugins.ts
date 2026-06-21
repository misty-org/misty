export type PluginRootKind = "public" | "private";

export type PluginLink = {
  label: string;
  url: string;
};

export type PluginAction = {
  label: string;
  kind: string;
};

export type PluginLauncher = {
  views: string[];
  show_in_launcher: boolean;
  requires_selected_file: boolean;
  open_mode: "inline" | "tab" | "split";
};

export type PluginArtifact = {
  platform: string;
  url: string;
  sha256?: string;
};

export type PluginCatalogEntry = {
  id: string;
  name: string;
  version: string;
  author: string;
  overview: string;
  logo_path?: string;
  status: string;
  capabilities: string[];
  where_it_appears: string[];
  permissions: string[];
  getting_started: string[];
  changelog: string[];
  links: PluginLink[];
  actions: PluginAction[];
  verified: boolean;
  launcher: PluginLauncher;
  install: {
    root: PluginRootKind;
    artifacts: PluginArtifact[];
  };
};

export type PluginCatalogIndexEntry = {
  id: string;
  name: string;
  url: string;
};

export type LocalPluginRecord = {
  id: string;
  name: string;
  version: string;
  author: string;
  overview: string;
  status: string;
  root: PluginRootKind;
  enabled: boolean;
  installed: boolean;
  verified: boolean;
  manifest_path: string;
  plugin_dir: string;
  logo_path?: string;
  capabilities: string[];
  where_it_appears: string[];
  permissions: string[];
  getting_started: string[];
  changelog: string[];
  links: PluginLink[];
  actions: PluginAction[];
  launcher: PluginLauncher;
};

export type PluginEntry = {
  id: string;
  name: string;
  version: string;
  author: string;
  overview: string;
  status: string;
  root: PluginRootKind;
  installed: boolean;
  enabled: boolean;
  verified: boolean;
  manifest_path?: string;
  plugin_dir?: string;
  logo_path?: string;
  capabilities: string[];
  where_it_appears: string[];
  permissions: string[];
  getting_started: string[];
  changelog: string[];
  links: PluginLink[];
  actions: PluginAction[];
  launcher: PluginLauncher;
  artifact?: PluginArtifact;
};
