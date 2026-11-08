import type { BrowserInternalPage } from "@/features/app-windows";

export interface BrowserInternalPageProps {
  /** Open an address in this tab. */
  navigate: (url: string) => void;
  /** Open an address in a new tab beside this one. */
  openInNewView: (url: string) => void;
  openPage: (page: BrowserInternalPage) => void;
  /** Ask for the Clear browsing data dialog. */
  clearBrowsingData: () => void;
}
