import type { BrowserInternalPage } from "@/features/workspace";

export interface BrowserInternalPageProps {
  /** The browser profile the tab belongs to, for per-profile history. */
  profileId?: string;
  /** Open an address in this tab. */
  navigate: (url: string) => void;
  /** Open an address in a new tab beside this one. */
  openInNewTab: (url: string) => void;
  openPage: (page: BrowserInternalPage) => void;
  /** Ask for the Clear browsing data dialog. */
  clearBrowsingData: () => void;
}
