export interface NavLinkEntry {
  to: string;
  label: string;
}

export const navItems: NavLinkEntry[] = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/download", label: "Download" },
];

export const resourceLinks: NavLinkEntry[] = [
  { to: "/blog", label: "Blog" },
  { to: "/changelog", label: "Changelog" },
  { to: "/roadmap", label: "Roadmap" },
];
