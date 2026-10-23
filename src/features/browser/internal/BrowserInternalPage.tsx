import { Navigate } from "react-router-dom";
import { Button } from "@/shared/ui";
import type { BrowserInternalPage as InternalPage } from "@/features/workspace";
import { BookmarksPage } from "./BookmarksPage";
import { DownloadsPage } from "./DownloadsPage";
import { HistoryPage } from "./HistoryPage";
import { SettingsRedirectPage } from "./SettingsRedirectPage";
import type { BrowserInternalPageProps } from "./types";

/** Draws a misty:// page in place of the tab's native web page. */
export function BrowserInternalPage(props: BrowserInternalPageProps & { page: InternalPage }) {
  const { page, ...pageProps } = props;
  switch (page) {
    case "scheduled":
      return <Navigate to="/scheduled" replace />;
    case "history":
      return <HistoryPage {...pageProps} />;
    case "downloads":
      return <DownloadsPage {...pageProps} />;
    case "passwords":
      return <SettingsRedirectPage page="passwords" />;
    case "bookmarks":
      return <BookmarksPage {...pageProps} />;
    case "extensions":
      return <SettingsRedirectPage page="extensions" />;
    case "settings":
      return (
        <SettingsRedirectPage
          page="settings"
          actions={
            <Button variant="outline" onClick={pageProps.clearBrowsingData}>
              Clear browsing data…
            </Button>
          }
        />
      );
  }
}

export type { BrowserInternalPageProps } from "./types";
