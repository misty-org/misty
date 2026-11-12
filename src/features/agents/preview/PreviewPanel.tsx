import { ExternalLink, MousePointerClick, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useBrowserRuntimeStore } from "@/features/app-windows";
import { usePresentedPageHost } from "@/features/browser";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, IconButton, Input, SkeletonDocument } from "@/shared/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { agentPageKey, useAgentPageGeometry } from "../agent-browser/useAgentPageGeometry";
import { errorText } from "../context-panel/projectApi";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { currentSpaceKey } from "../engines/enginesApi";
import { PickedElementCard } from "./PickedElementCard";
import { withElementBlock } from "./pickedElement";
import { previewApi, type PreviewPick } from "./previewApi";
import { useHostInView } from "./useHostInView";
import {
  parsePreviewUrl,
  rememberedPreviewUrl,
  rememberPreviewUrl,
  shownPreviewUrl,
} from "./previewUrl";

type Status = "opening" | "ready" | "failed";

/**
 * The person's own local app beside the chat. It runs in one of Misty's native pages placed over
 * this panel's frame, so the person can point at an element and hand its details to their agent.
 * Only addresses on this computer load here; it is a preview, not a browser.
 */
export default function PreviewPanel() {
  const space = currentSpaceKey();
  const [url, setUrl] = useState(() => rememberedPreviewUrl(space));
  const [typed, setTyped] = useState(() => shownPreviewUrl(url));
  // Reloading opens the page again, which also retries a dev server that wasn't up yet.
  const [attempt, setAttempt] = useState(0);
  const [viewId, setViewId] = useState("");
  const [status, setStatus] = useState<Status>("opening");
  const [refused, setRefused] = useState("");
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<PreviewPick | null>(null);
  const [sent, setSent] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  // The page is placed only while this panel is the one on screen; in a tab the person left it
  // waits out of sight, still running. A panel that was never on screen opens no page at all.
  const inView = useHostInView(host);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (inView) setSeen(true);
  }, [inView]);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    let opened = "";
    setStatus("opening");
    setViewId("");
    setPicking(false);
    void previewApi
      .reachable(url)
      .then(async (answers) => {
        if (!live) return;
        if (!answers) {
          setStatus("failed");
          return;
        }
        const id = await previewApi.open(url);
        if (!live) return previewApi.close(id);
        opened = id;
        setViewId(id);
        const loaded = await previewApi.loaded(id).catch(() => false);
        if (!live) return;
        if (!loaded) {
          setViewId("");
          setStatus("failed");
          return;
        }
        setStatus("ready");
        await previewApi.watch(id).catch(() => undefined);
      })
      .catch((reason) => {
        if (!live) return;
        setStatus("failed");
        setError(errorText(reason));
      });
    return () => {
      live = false;
      if (opened) void previewApi.close(opened);
    };
  }, [url, attempt, seen]);

  const placedId = inView ? viewId : "";
  const presented = useBrowserRuntimeStore((state) =>
    Boolean(placedId && state.presented[agentPageKey(placedId)]),
  );
  usePresentedPageHost(agentPageKey(placedId), Boolean(placedId) && presented);
  useAgentPageGeometry(host, placedId);

  const load = (event: FormEvent) => {
    event.preventDefault();
    const address = parsePreviewUrl(typed);
    if (!address.ok) {
      setRefused(address.message);
      return;
    }
    setRefused("");
    setTyped(shownPreviewUrl(address.url));
    rememberPreviewUrl(space, address.url);
    if (address.url === url) setAttempt((count) => count + 1);
    else setUrl(address.url);
  };

  const togglePick = () => {
    if (!viewId) return;
    if (picking) {
      void previewApi.cancelPick(viewId).catch(() => undefined);
      return;
    }
    setPicking(true);
    setSent(false);
    void previewApi
      .pick(viewId)
      .then((picked) => {
        if (picked) setPick(picked);
      })
      .catch((reason) => setError(errorText(reason)))
      .finally(() => setPicking(false));
  };

  // Into the open chat's composer, after whatever is already written there. Nothing is sent.
  const sendToAgent = () => {
    if (!pick) return;
    const chat = useMistyStore.getState();
    chat.setQuery(withElementBlock(chat.query, pick.element));
    setSent(true);
  };

  return (
    <div className="preview-panel">
      <form className="preview-bar" onSubmit={load} noValidate>
        <Input
          variant="address"
          className="preview-address"
          aria-label="Local address"
          aria-invalid={refused ? true : undefined}
          placeholder="http://localhost:3000"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setRefused("");
          }}
        />
        <IconButton label="Reload" onClick={() => setAttempt((count) => count + 1)}>
          <RotateCw size={15} />
        </IconButton>
        <IconButton
          label="Open in my browser"
          onClick={() => void openExternalLink(url).catch((reason) => setError(errorText(reason)))}
        >
          <ExternalLink size={15} />
        </IconButton>
        <Button
          type="button"
          aria-pressed={picking}
          disabled={status !== "ready"}
          onClick={togglePick}
        >
          <MousePointerClick size={15} />
          <span>{picking ? "Cancel" : "Pick an element"}</span>
        </Button>
      </form>
      {refused ? (
        <p className="preview-refused" role="alert">
          {refused}
        </p>
      ) : null}
      <div className="preview-stage">
        <div
          ref={host}
          className="preview-host"
          data-browser-page-host=""
          data-browser-page-awaiting={placedId && !presented ? "" : undefined}
          data-browser-page-presented={placedId && presented ? "" : undefined}
          data-picking={picking ? "" : undefined}
        >
          {status === "failed" ? (
            <p className="preview-note">
              Nothing answered at {shownPreviewUrl(url)}. Start your app, then reload.
            </p>
          ) : presented ? null : (
            <SkeletonDocument label="Preview" className="preview-skeleton" />
          )}
        </div>
      </div>
      {pick ? (
        <PickedElementCard
          pick={pick}
          sent={sent}
          onSend={sendToAgent}
          onClear={() => {
            setPick(null);
            setSent(false);
          }}
        />
      ) : null}
      <ErrorNotice message={error} onDismiss={() => setError("")} />
    </div>
  );
}
