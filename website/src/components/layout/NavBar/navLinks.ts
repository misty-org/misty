export interface NavLinkEntry {
  to: string;
  label: string;
}

export const navItems: NavLinkEntry[] = [
  { to: "/download", label: "Download" },
  { to: "/pricing", label: "Pricing" },
];

export const resourceLinks: NavLinkEntry[] = [
  { to: "/blog", label: "Blog" },
  { to: "/changelog", label: "Changelog" },
  { to: "/roadmap", label: "Roadmap" },
];
