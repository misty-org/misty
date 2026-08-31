export type MarketplaceView = "marketplace" | "installed";

export type MarketplaceEntry = {
  id: string;
  kind?: "app" | "extension" | "builtin";
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
