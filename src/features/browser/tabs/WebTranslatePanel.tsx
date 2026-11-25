import { invoke } from "@tauri-apps/api/core";
import { Languages } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ErrorState, PaneLoading, SidePanel } from "@misty/ui";

export interface WebPageText {
  title: string;
  lang: string;
  text: string;
}

export interface WebTranslator {
  translate(page: WebPageText, onText: (text: string) => void, signal: AbortSignal): Promise<string>;
  render(text: string, streaming: boolean): ReactNode;
}

export function WebTranslatePanel(props: {
  viewId: string;
  url: string;
  translator: WebTranslator;
  onClose(): void;
}) {
  const { viewId, url, translator } = props;
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!viewId) return;
    const stop = new AbortController();
    setText("");
    setDone(false);
    setError("");
    void invoke<WebPageText>("browser_webview_page_text", { request: { id: viewId } })
      .then((page) => translator.translate(page, setText, stop.signal))
      .then((final) => {
        if (stop.signal.aborted) return;
        setText(final);
        setDone(true);
      })
      .catch((failure: unknown) => {
        if (stop.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => stop.abort();
  }, [viewId, url, translator, attempt]);

  return (
    <SidePanel label="Translation" name="Translation" icon={Languages} onClose={props.onClose}>
      {error ? (
        <ErrorState
          title="The page couldn't be translated"
          line={error}
          action={{ label: "Try again", onClick: () => setAttempt((value) => value + 1) }}
        />
      ) : text ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{translator.render(text, !done)}</div>
      ) : (
        <PaneLoading label="Translation" />
      )}
    </SidePanel>
  );
}
