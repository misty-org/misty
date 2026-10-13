import { AgentTabAway } from "@/features/agents";
import type { browserInternalPage} from "@/features/workspace";
import { blankBrowserUrl, type WorkspaceView } from "@/features/workspace";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { cn } from "@/shared/ui";
import type { RefObject } from "react";
import { BrowserInternalPage } from "../internal/BrowserInternalPage";
import { BrowserAnnotationLayer } from "./BrowserAnnotationLayer";
import { setBrowserError } from "./browserErrors";
import { BrowserMistyRow } from "./BrowserMistyPanel";
import { BrowserNativeRuntimeRequired } from "./BrowserNativeRuntimeRequired";
import { BrowserOfflinePage } from "./BrowserOfflinePage";
import { ReaderView } from "./ReaderView";
import { browserViewportFrameStyle, browserViewportStageStyle } from "./BrowserViewportMenu";
import type { ReaderArticle } from "./readerArticle";
import type { useBrowserPageCommands } from "./useBrowserPageCommands";

/** The area under the toolbar: the native page host plus whatever Misty draws over it. */
export function BrowserPageStage({
  tab,
  url,
  viewport,
  viewportSize,
  chromeBackground,
  pageHostRef,
  annotationsActive,
  onCloseAnnotations,
  internalPage,
  profileId,
  isOffline,
  away,
  nativeRuntime,
  commands,
  navigate,
  onRetry,
  onGoHome,
  reader,
}: {
  tab: WorkspaceView;
  url: string;
  viewport: string;
  viewportSize: Parameters<typeof browserViewportFrameStyle>[0];
  chromeBackground: string;
  pageHostRef: RefObject<HTMLDivElement | null>;
  annotationsActive: boolean;
  onCloseAnnotations: () => void;
  internalPage: ReturnType<typeof browserInternalPage>;
  profileId: string | undefined;
  isOffline: boolean;
  away: boolean;
  nativeRuntime: boolean;
  commands: ReturnType<typeof useBrowserPageCommands>["commands"];
  navigate: (address: string) => void;
  onRetry: () => void;
  onGoHome: () => void;
  reader: { article: ReaderArticle | null; close: () => void };
}) {
  return (
    <BrowserMistyRow tabId={tab.id}>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden",
          viewport === "responsive" ? "p-0" : "p-3",
          viewport === "responsive" ? undefined : "bg-charcoal-workspace",
        )}
        style={{
          ...browserViewportStageStyle,
          backgroundColor: viewport === "responsive" ? chromeBackground : undefined,
        }}
        data-browser-page-stage
      >
        <div
          ref={pageHostRef}
          className={cn(
            "relative min-h-0 min-w-0 overflow-hidden transition-[border-radius,box-shadow] duration-200",
            viewport === "responsive"
              ? "rounded-none shadow-none"
              : "rounded-xl shadow-2xl ring-1 ring-black/15",
            annotationsActive && "bg-transparent",
          )}
          style={{
            ...browserViewportFrameStyle(viewportSize),
            backgroundColor: annotationsActive
              ? "transparent"
              : internalPage || isOffline
                ? chromeBackground
                : `var(--browser-page-background, ${chromeBackground})`,
          }}
          data-browser-page-host
          data-browser-viewport={viewport}
        >
          {away ? (
            <AgentTabAway />
          ) : internalPage ? (
            <BrowserInternalPage
              page={internalPage}
              profileId={profileId}
              navigate={navigate}
              openInNewView={commands.openInNewTab}
              openPage={commands.openPage}
              clearBrowsingData={commands.clearBrowsingData}
            />
          ) : isOffline ? (
            <BrowserOfflinePage url={url} onRetry={onRetry} onGoHome={onGoHome} />
          ) : !nativeRuntime && url !== blankBrowserUrl ? (
            <BrowserNativeRuntimeRequired
              url={url}
              onOpenExternal={() =>
                void openSystemExternalLink(url).catch((error: unknown) =>
                  setBrowserError(tab.id, error),
                )
              }
            />
          ) : null}
          {reader.article && !internalPage ? (
            <ReaderView article={reader.article} onClose={reader.close} />
          ) : null}
          <BrowserAnnotationLayer active={annotationsActive} onClose={onCloseAnnotations} />
        </div>
      </div>
    </BrowserMistyRow>
  );
}
