import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ErrorState,
  FindBar,
  FramedBar,
  FramedPage,
  PageStage,
  notify,
} from "@misty/ui";
import { useBrowserRuntimeStore, useWorkspaceViewTitle } from "@/features/app-windows";
import { BrowserNavigationButtons } from "../webviews/BrowserNavigationButtons";
import { usePresentedPageHost } from "../webviews/presented_page_host";
import { useWebPageGeometry, webPageKey } from "./use_web_page_geometry";
import { pageLabel } from "./web_address";
import { dropPermissionAsks } from "./web_permissions";
import { ensureWebTab, useWebTabs } from "./web_tab_store";
import {
  findInPage,
  goBack,
  goForward,
  goTo,
  reload,
  setZoom,
  stopLoading,
  wakeWebTab,
} from "./web_tabs";
import { takeWebPicture, WebAnnotatePage, type WebPicture } from "./WebAnnotate";
import { WebAddressField } from "./WebAddressField";
import { WebDownloadsButton } from "./WebDownloadsButton";
import { WebHistoryDialog } from "./WebHistoryDialog";
import { WebPermissionAsk, WebSiteInfo } from "./WebSitePermissions";
import { WebTabMenu } from "./WebTabMenu";
import { WebTranslatePanel, type WebTranslator } from "./WebTranslatePanel";

export interface WebTabPageProps {
  tabId: string;
  viewId: string;
  spaceId: string;
  spaceName(id: string): string;
  onShowFiles(spaceId: string): void;
  onSwitchTab(tabId: string): void;
  onOpenBeside(url: string): void;
  translator?: WebTranslator;
  onAddToChat?(file: File): Promise<void>;
}

function useFind(tabId: string) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [result, setResult] = useState({ current: 0, total: 0 });
  useEffect(() => {
    if (!open) return;
    let current = true;
    void findInPage(tabId, query, query ? "next" : "clear", matchCase).then((found) => {
      if (current) setResult(found);
    });
    return () => {
      current = false;
    };
  }, [tabId, open, query, matchCase]);
  const step = (direction: "next" | "previous") =>
    void findInPage(tabId, query, direction, matchCase).then(setResult);
  const close = () => {
    setOpen(false);
    setQuery("");
    setResult({ current: 0, total: 0 });
    void findInPage(tabId, "", "clear", false);
  };
  return { open, setOpen, query, setQuery, matchCase, setMatchCase, result, step, close };
}

const failureText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : fallback;

export function WebTabPage(props: WebTabPageProps) {
  const { tabId, spaceId } = props;
  useEffect(() => void ensureWebTab(tabId), [tabId]);
  const tab = useWebTabs((state) => state.tabs[tabId]);
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [annotating, setAnnotating] = useState<WebPicture | null>(null);
  const viewId = tab?.viewId ?? "";
  const url = tab?.url ?? "";
  const failure = tab?.failure;
  const wanted = /^https?:\/\//i.test(url);
  const shownView = failure || annotating ? "" : viewId;
  const presented = useBrowserRuntimeStore((state) =>
    Boolean(viewId && state.presented[webPageKey(viewId)]),
  );
  const find = useFind(tabId);
  const findInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (find.open) findInput.current?.focus();
  }, [find.open]);
  useEffect(() => {
    if (!viewId) return;
    return () => dropPermissionAsks(viewId);
  }, [viewId]);
  usePresentedPageHost(webPageKey(viewId), Boolean(shownView) && presented);
  useWebPageGeometry(host, shownView);
  useWorkspaceViewTitle(props.viewId, wanted ? pageLabel(url, tab?.title ?? "") : "New tab");

  useEffect(() => {
    if (!wanted || viewId) return;
    let current = true;
    setFailed(false);
    void wakeWebTab(tabId, spaceId, host.current).then((open) => {
      if (current && !open) setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [tabId, spaceId, wanted, viewId, attempt]);

  const go = (text: string) => void goTo(tabId, text, spaceId);
  const findKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      find.step(event.shiftKey ? "previous" : "next");
    } else if (event.key === "Escape") {
      event.preventDefault();
      find.close();
    }
  };
  const pageCommand = (command: string) =>
    invoke(command, { request: { id: viewId } }).catch((error: unknown) =>
      notify({ message: failureText(error, "That didn't work on this page."), tone: "error" }),
    );
  const savePage = () =>
    void invoke<{ fileName: string }>("browser_webview_save_page", {
      request: { id: viewId, title: tab?.title ?? "", spaceId: tab?.spaceId || spaceId },
    })
      .then(({ fileName }) =>
        notify({
          message: `Saved ${fileName}`,
          action: { label: "Show", onSelect: () => props.onShowFiles(tab?.spaceId || spaceId) },
        }),
      )
      .catch((error: unknown) =>
        notify({ message: failureText(error, "The page couldn't be saved."), tone: "error" }),
      );
  const pictureInPicture = () =>
    void invoke<{ result: string }>("browser_webview_picture_in_picture", {
      request: { id: viewId },
    })
      .then(({ result }) => {
        if (result === "none") notify({ message: "There's no video on this page." });
        else if (result === "unsupported")
          notify({ message: "This video can't play in picture in picture.", tone: "error" });
      })
      .catch(() => notify({ message: "Picture in picture didn't start.", tone: "error" }));
  const annotate = () =>
    window.setTimeout(() => {
      void takeWebPicture(viewId)
        .then(setAnnotating)
        .catch((error: unknown) =>
          notify({ message: failureText(error, "The page's picture couldn't be taken."), tone: "error" }),
        );
    }, 250);

  if (annotating && props.onAddToChat)
    return (
      <WebAnnotatePage
        picture={annotating}
        title={pageLabel(url, tab?.title ?? "")}
        onAddToChat={props.onAddToChat}
        onClose={() => setAnnotating(null)}
      />
    );

  return (
    <FramedPage
      autoSaveId="web-tab"
      toolbar={
        <FramedBar
          size="tools"
          aria-label="Page controls"
          start={
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <BrowserNavigationButtons
                canGoBack={Boolean(tab?.canGoBack)}
                canGoForward={Boolean(tab?.canGoForward)}
                showStop={Boolean(tab?.loading)}
                reloadDisabled={!viewId}
                onTravel={(direction) => (direction < 0 ? goBack(tabId) : goForward(tabId))}
                onStop={() => stopLoading(tabId)}
                onReload={() => reload(tabId)}
              />
              <WebSiteInfo url={url} />
              <WebAddressField
                tabId={tabId}
                url={url}
                autoFocus={Boolean(tab?.fresh)}
                onGo={go}
                onOpenBeside={props.onOpenBeside}
                onSwitchTab={props.onSwitchTab}
              />
            </div>
          }
        >
          <WebDownloadsButton spaceName={props.spaceName} onShowFiles={props.onShowFiles} />
          <WebTabMenu
            url={url}
            zoom={tab?.zoom ?? 1}
            live={Boolean(viewId) && !failure}
            onFind={() => find.setOpen(true)}
            onZoom={(zoom) => setZoom(tabId, zoom)}
            onGo={go}
            onPrint={() => void pageCommand("browser_webview_print")}
            onSavePage={savePage}
            onPictureInPicture={pictureInPicture}
            onInspect={() => void pageCommand("browser_webview_inspect")}
            onTranslate={props.translator ? () => setTranslating(true) : undefined}
            onAnnotate={props.onAddToChat ? annotate : undefined}
            onShowHistory={() => setHistory(true)}
          />
        </FramedBar>
      }
      end={
        translating && props.translator
          ? {
              id: "translation",
              label: "Resize the translation",
              width: 360,
              minWidth: 270,
              content: (
                <WebTranslatePanel
                  viewId={viewId}
                  url={url}
                  translator={props.translator}
                  onClose={() => setTranslating(false)}
                />
              ),
            }
          : null
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {find.open ? (
          <FindBar
            label="Find on page"
            find={{
              value: find.query,
              onChange: find.setQuery,
              onKeyDown: findKeys,
              inputRef: findInput,
            }}
            caseSensitive={find.matchCase}
            onCaseSensitive={() => find.setMatchCase(!find.matchCase)}
            count={`${find.result.current}/${find.result.total}`}
            empty={Boolean(find.query) && find.result.total === 0}
            canStep={find.result.total > 0}
            onPrevious={() => find.step("previous")}
            onNext={() => find.step("next")}
            onClose={find.close}
          />
        ) : null}
        <WebPermissionAsk viewId={viewId} />
        <PageStage
          hostRef={host}
          placed={Boolean(shownView)}
          presented={Boolean(shownView) && presented}
        >
          {failure ? (
            <ErrorState
              title={failure.offline ? "You're offline" : "This page couldn't open"}
              line={failure.offline ? "Check your connection, then try again." : failure.message}
              action={{ label: "Try again", onClick: () => reload(tabId) }}
            />
          ) : failed && !viewId ? (
            <ErrorState
              title="This page couldn't open"
              line="Something went wrong opening it."
              action={{ label: "Try again", onClick: () => setAttempt((value) => value + 1) }}
            />
          ) : null}
        </PageStage>
      </div>
      {history ? (
        <WebHistoryDialog
          onClose={() => setHistory(false)}
          onGo={go}
          onOpenBeside={props.onOpenBeside}
        />
      ) : null}
    </FramedPage>
  );
}
