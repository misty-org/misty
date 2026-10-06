export type ExtensionCategory = { id: string; name: string };

/** Shown until the live Firefox Add-ons category list loads. */
export const defaultCategories: ExtensionCategory[] = [
  { id: "privacy-security", name: "Privacy and security" },
  { id: "tabs", name: "Tabs" },
  { id: "web-development", name: "Developer tools" },
  { id: "feeds-news-blogging", name: "Reading and news" },
];
