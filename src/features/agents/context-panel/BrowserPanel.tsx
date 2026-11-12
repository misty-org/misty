import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, ExternalLink, MessageSquarePlus, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useBrowserRuntimeStore } from "@/features/app-windows";
import { usePresentedPageHost } from "@/features/browser";
import { invoke } from "@/native/invoke";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { ErrorNotification, IconButton, Input, SkeletonDocument } from "@/shared/ui";
import { agentPageKey, useAgentPageGeometry } from "../agent-browser/useAgentPageGeometry";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { currentSpaceKey } from "../engines/enginesApi";
import { previewApi } from "../preview/previewApi";
import { useHostInView } from "../preview/useHostInView";
import { errorText } from "./projectApi";
import { browserAddress, rememberAddress, rememberedAddress } from "./browserAddress";

/**
 * A plain browser beside the chat, for the person: an address field, back, forward and reload,
 * on one of Misty's native pages with the person's signed-in sites. Agents don't drive it; to
 * have an agent work in a browser, the person attaches Misty's browser to a message.
 */
export default function BrowserPanel() {
  const space = currentSpaceKey();
  const [start] = useState(() => rememberedAddress(space));
  const [url, setUrl] = useState(start);
  const [typed, setTyped] = useState(start);
  const [editing, setEditing] = useState(false);
  const [viewId, setViewId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  // Opened the first time the panel is on screen, and kept while the chat is open.
  const inView = useHostInView(host);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (inView) setSeen(true);
  }, [inView]);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    let opened = "";
    void previewApi
      .open(start)
      .then((id) => {
        if (!live) return previewApi.close(id);
        opened = id;
        setViewId(id);
      })
      .catch((reason) => setError(errorText(reason)));
    return () => {
      live = false;
      if (opened) void previewApi.close(opened);
    };
  }, [seen, start]);

  // Where the page went by itself (a link, a redirect) shows in the address field.
  useEffect(() => {
    if (!viewId || !hasTauriInternals()) return;
    let stop: (() => void) | undefined;
    let live = true;
    void listen<{ id: string; url: string; phase: string }>(
      "misty://browser-page",
      ({ payload }) => {
        if (payload.id !== viewId) return;
        if (payload.phase === "started") setLoading(true);
        if (payload.phase === "finished") setLoading(false);
        if (/^https?:\/\//i.test(payload.url)) {
          setUrl(payload.url);
          rememberAddress(space, payload.url);
          setAdded(false);
        }
      },
    ).then((unlisten) => (live ? (stop = unlisten) : unlisten()));
    return () => {
      live = false;
      stop?.();
    };
  }, [viewId, space]);

  useEffect(() => {
    if (!editing) setTyped(url);
  }, [url, editing]);

  const placedId = inView ? viewId : "";
  const presented = useBrowserRuntimeStore((state) =>
    Boolean(placedId && state.presented[agentPageKey(placedId)]),
  );
  usePresentedPageHost(agentPageKey(placedId), Boolean(placedId) && presented);
  useAgentPageGeometry(host, placedId);

  const go = (event: FormEvent) => {
    event.preventDefault();
    const address = browserAddress(typed);
    if (!address || !viewId) return;
    setEditing(false);
    setUrl(address);
    rememberAddress(space, address);
    void previewApi.navigate(viewId, address).catch((reason) => setError(errorText(reason)));
  };
  const step = (command: "browser_webview_back" | "browser_webview_forward") =>
    viewId &&
    void invoke(command, { request: { id: viewId } }).catch((reason) =>
      setError(errorText(reason)),
    );

  // Into the open chat's message, after whatever is already written. Nothing is sent.
  const addToMessage = () => {
    const chat = useMistyStore.getState();
    const query = chat.query.trimEnd();
    chat.setQuery(query ? `${query}\n${url}` : url);
    setAdded(true);
  };

  return (
    <div className="preview-panel">
      <form className="preview-bar" onSubmit={go} noValidate>
        <IconButton label="Back" disabled={!viewId} onClick={() => step("browser_webview_back")}>
          <ArrowLeft size={15} />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!viewId}
          onClick={() => step("browser_webview_forward")}
        >
          <ArrowRight size={15} />
        </IconButton>
        <IconButton
          label="Reload"
          disabled={!viewId}
          onClick={() => viewId && void previewApi.reload(viewId).catch(() => undefined)}
        >
          <RotateCw size={15} />
        </IconButton>
        <Input
          variant="address"
          className="preview-address"
          aria-label="Address"
          placeholder="Search or enter an address"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={typed}
          data-loading={loading || undefined}
          onFocus={(event) => {
            setEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onChange={(event) => setTyped(event.target.value)}
        />
        <IconButton
          label={added ? "Added to your message" : "Add this page to your message"}
          disabled={added}
          onClick={addToMessage}
        >
          <MessageSquarePlus size={15} />
        </IconButton>
        <IconButton
          label="Open in my browser"
          onClick={() => void openExternalLink(url).catch((reason) => setError(errorText(reason)))}
        >
          <ExternalLink size={15} />
        </IconButton>
      </form>
      <div className="preview-stage">
        <div
          ref={host}
          className="preview-host"
          data-browser-page-host=""
          data-browser-page-awaiting={placedId && !presented ? "" : undefined}
          data-browser-page-presented={placedId && presented ? "" : undefined}
        >
          {presented ? null : <SkeletonDocument label="Page" className="preview-skeleton" />}
        </div>
      </div>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </div>
  );
}
