import { ExternalLink, MousePointerClick, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useBrowserRuntimeStore } from "@/features/app-windows";
import { usePresentedPageHost } from "@/features/browser";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  IconButton,
  Input,
  PageStage,
  Separator,
  SidePanelHeader,
  SkeletonDocument,
  Surface,
  Text,
} from "@/shared/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { agentPageKey, useAgentPageGeometry } from "../agent-browser/useAgentPageGeometry";
import { errorText } from "../context-panel/projectApi";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { currentSpaceKey } from "../engines/enginesApi";
import { PickedElementCard } from "./PickedElementCard";
import { withElementBlock } from "./pickedElement";
import { previewApi, type PreviewPick } from "./previewApi";
import { useHostInView } from "./useHostInView";
import { browserAddress } from "../context-panel/browserAddress";
import { openInChatBrowser } from "../tabs/agentPersonTabs";
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
 * Only addresses on this computer load here; any other address opens in the chat's agent browser.
 */
export default function PreviewPanel({ conversationId }: { conversationId: string }) {
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
      // Another site is the browser's work, not the preview's.
      const elsewhere = browserAddress(typed);
      if (conversationId && elsewhere && /^https?:/.test(elsewhere)) {
        setTyped(shownPreviewUrl(url));
        void openInChatBrowser(conversationId, elsewhere);
        return;
      }
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The address row is the panel's header row. */}
      <SidePanelHeader>
        <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={load} noValidate>
          <Input
            variant="address"
            className="flex-1 text-caption"
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
            <RotateCw />
          </IconButton>
          <IconButton
            label="Open in my browser"
            onClick={() =>
              void openExternalLink(url).catch((reason) => setError(errorText(reason)))
            }
          >
            <ExternalLink />
          </IconButton>
          <Button
            type="button"
            variant="quiet"
            aria-pressed={picking}
            disabled={status !== "ready"}
            onClick={togglePick}
          >
            <MousePointerClick />
            <span>{picking ? "Cancel" : "Pick an element"}</span>
          </Button>
        </form>
      </SidePanelHeader>
      {refused ? (
        // Painted, like everything here but the page, so the page shows only through its frame.
        <Surface tone="sidebar" className="flex-none">
          <Text size="caption" tone="changed" wrap role="alert" className="px-3 py-2">
            {refused}
          </Text>
          <Separator />
        </Surface>
      ) : null}
      <PageStage
        hostRef={host}
        placed={Boolean(placedId)}
        presented={presented}
        picking={picking}
        inset
      >
        {status === "failed" ? (
          <Text
            size="meta"
            tone="muted"
            wrap
            className="absolute inset-0 grid place-items-center p-6 text-center"
          >
            Nothing answered at {shownPreviewUrl(url)}. Start your app, then reload.
          </Text>
        ) : (
          <SkeletonDocument label="Preview" className="absolute inset-0" />
        )}
      </PageStage>
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
