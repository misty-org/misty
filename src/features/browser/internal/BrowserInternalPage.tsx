import type { BrowserInternalPage as InternalPage } from "@/features/workspace";
import { BookmarksPage } from "./BookmarksPage";
import { BrowserSettingsPage } from "./BrowserSettingsPage";
import { DownloadsPage } from "./DownloadsPage";
import { ExtensionsPage } from "./ExtensionsPage";
import { HistoryPage } from "./HistoryPage";
import type { BrowserInternalPageProps } from "./types";

/** Draws a misty:// page in place of the tab's native web page. */
export function BrowserInternalPage(props: BrowserInternalPageProps & { page: InternalPage }) {
  const { page, ...pageProps } = props;
  switch (page) {
    case "history":
      return <HistoryPage {...pageProps} />;
    case "downloads":
      return <DownloadsPage {...pageProps} />;
    case "bookmarks":
      return <BookmarksPage {...pageProps} />;
    case "extensions":
      return <ExtensionsPage />;
    case "settings":
      return <BrowserSettingsPage {...pageProps} />;
  }
}

export type { BrowserInternalPageProps } from "./types";
