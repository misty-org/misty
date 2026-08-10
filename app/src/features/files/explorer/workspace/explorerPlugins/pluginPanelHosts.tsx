import { extensionCommandRun, pluginPanelRender } from "@/features/files/native";
import type { PluginPanelEntry, PluginPanelRenderResult } from "@/native/contracts";
import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import { errorText } from "@/shared/lib/format";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { Puzzle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectedPathsForPane, useExplorerStore } from "../../store";
import { pluginTabHostStyles } from "../ExplorerDesktopPluginStyles";
import { PluginPanelElementView } from "./PluginPanelElementView";
import { monitorExtensionJob } from "./extensionJobs";

export function ExplorerPluginPanelHost(props: { panel: PluginPanelEntry; selectedPath: string }) {
  if (props.panel.webEntry)
    return <ExplorerWebPluginPanelHost panel={props.panel} selectedPath={props.selectedPath} />;
  return <ExplorerNativePluginPanelHost panel={props.panel} selectedPath={props.selectedPath} />;
}

export function ExplorerNativePluginPanelHost(props: {
  panel: PluginPanelEntry;
  selectedPath: string;
}) {
  const [rendered, setRendered] = useState<PluginPanelRenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(rendering);

  const renderPanel = useCallback(
    (clickedButton = "") => {
      setRendering(true);
      setRenderError("");
      void pluginPanelRender({
        panelId: props.panel.id,
        pluginId: props.panel.pluginId,
        selectedPaths: props.selectedPath ? [props.selectedPath] : [],
        clickedButton,
        inputs,
      })
        .then((result) => {
          setRendered(result);
        })
        .catch((error) => setRenderError(errorText(error)))
        .finally(() => setRendering(false));
    },
    [inputs, props.panel.id, props.panel.pluginId, props.selectedPath],
  );

  useEffect(() => {
    setInputs({});
    setRendered(null);
    setRenderError("");
    setRendering(true);
    void pluginPanelRender({
      panelId: props.panel.id,
      pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
    })
      .then((result) => {
        setRendered(result);
      })
      .catch((error) => setRenderError(errorText(error)))
      .finally(() => setRendering(false));
  }, [props.panel.id, props.panel.pluginId, props.selectedPath]);

  return (
    <section className={pluginTabHostStyles.panel}>
      <header className={pluginTabHostStyles.panelHeader}>
        <div>
          <h3>{rendered?.title ?? props.panel.title}</h3>
          <span>{props.panel.pluginName}</span>
        </div>
        <Button
          className={pluginTabHostStyles.button}
          type="button"
          onClick={() => {
            startRefreshSpin();
            renderPanel();
          }}
          disabled={rendering}
        >
          <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={13} />
          Refresh
        </Button>
      </header>
      {renderError ? <div className={pluginTabHostStyles.error}>{renderError}</div> : null}
      {rendered && rendered.runtimeStatus !== "native_rendered" ? (
        <div className={pluginTabHostStyles.notice}>
          <Puzzle size={20} />
          <span>{rendered.message || "Extension panel unavailable."}</span>
        </div>
      ) : null}
      {!rendered && !renderError ? (
        <div className={pluginTabHostStyles.loading}>Loading extension panel...</div>
      ) : null}
      {rendered?.runtimeStatus === "native_rendered" ? (
        <div className={pluginTabHostStyles.elements}>
          {rendered.elements.map((element) => (
            <PluginPanelElementView
              key={element.id}
              element={element}
              value={inputs[element.id] ?? element.text}
              disabled={rendering}
              onInput={(value) => setInputs((current) => ({ ...current, [element.id]: value }))}
              onButton={() => renderPanel(element.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function webPanelUrl(panel: PluginPanelEntry): string {
  const [path, query = ""] = panel.webEntry.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("hosted", "1");
  if (!hasTauriInternals()) return `${path}?${params.toString()}`;
  const pluginRoot = panel.pluginDir.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  if (!normalizedPath.startsWith(`${pluginRoot}/`)) return "about:blank";
  const rootKind = pluginRoot.includes("/plugins/private/")
    ? "private"
    : pluginRoot.includes("/plugins/public/")
      ? "public"
      : "";
  if (!rootKind) return "about:blank";
  const relative = normalizedPath.slice(pluginRoot.length + 1);
  const safeSegments = relative.split("/").filter(Boolean);
  if (
    safeSegments.length === 0 ||
    safeSegments.some((segment) => segment === "." || segment === "..")
  )
    return "about:blank";
  const route = [rootKind, panel.pluginId, ...safeSegments].map(encodeURIComponent).join("/");
  const base = navigator.userAgent.includes("Windows")
    ? "http://misty-extension.localhost"
    : "misty-extension://localhost";
  return `${base}/${route}?${params.toString()}`;
}

export function ExplorerWebPluginPanelHost(props: {
  panel: PluginPanelEntry;
  selectedPath: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hostState, setHostState] = useState<"loading" | "ready" | "failed">("loading");
  const timeoutRef = useRef<number | null>(null);
  const source = useMemo(() => webPanelUrl(props.panel), [props.panel]);
  const currentSelection = useCallback(() => {
    const selections = Object.values(useExplorerStore.getState().panes)
      .map(selectedPathsForPane)
      .find((paths) => paths.includes(props.selectedPath));
    return selections?.length ? selections : props.selectedPath ? [props.selectedPath] : [];
  }, [props.selectedPath]);

  const postContext = useCallback(() => {
    if (hostState !== "ready") return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        channel: "misty-host",
        kind: "context",
        pluginId: props.panel.pluginId,
        selectedPaths: currentSelection(),
      },
      "*",
    );
  }, [currentSelection, hostState, props.panel.pluginId]);

  const beginHandshake = useCallback(() => {
    setHostState("loading");
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setHostState("failed"), 8_000);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const request = event.data as {
        channel?: string;
        kind?: string;
        requestId?: string;
        pluginId?: string;
        protocolVersion?: number;
        command?: string;
        payload?: Record<string, unknown>;
      } | null;
      if (
        !request ||
        request.channel !== "misty-plugin" ||
        request.pluginId !== props.panel.pluginId
      )
        return;
      if (request.kind === "ready" && request.protocolVersion === 1) {
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setHostState("ready");
        return;
      }
      if (
        request.kind !== "request" ||
        typeof request.requestId !== "string" ||
        typeof request.command !== "string"
      )
        return;
      const command = request.command;
      const respond = (ok: boolean, result?: unknown, error?: string) =>
        iframeRef.current?.contentWindow?.postMessage(
          {
            channel: "misty-host",
            kind: "response",
            requestId: request.requestId,
            ok,
            result,
            error,
          },
          "*",
        );
      const payload = request.payload ?? {};
      if (request.command === "host.selectedPaths") {
        respond(true, { ok: true, selectedPaths: currentSelection() });
        return;
      }
      if (request.command === "host.pickFolders" && props.panel.pluginId === "backups") {
        void open({
          directory: true,
          multiple: payload.multiple !== false,
          title: typeof payload.title === "string" ? payload.title : "Choose folders",
        })
          .then((value) =>
            respond(true, {
              ok: true,
              paths: value == null ? [] : Array.isArray(value) ? value : [value],
            }),
          )
          .catch((error) => respond(false, undefined, errorText(error)));
        return;
      }
      if (request.command === "host.notify") {
        const level =
          payload.level === "success" || payload.level === "error" ? payload.level : "info";
        const message =
          typeof payload.message === "string"
            ? payload.message.slice(0, 500)
            : "Extension notification";
        useExplorerStore.getState().pushNotification(message, level, 4500);
        respond(true, { ok: true });
        return;
      }
      void extensionCommandRun({ pluginId: props.panel.pluginId, command, payload })
        .then((result) => {
          const started = result as { jobId?: string };
          if (typeof started.jobId === "string" && started.jobId)
            monitorExtensionJob(props.panel.pluginId, props.panel.pluginName, started.jobId);
          respond(true, result);
        })
        .catch((error) => respond(false, undefined, errorText(error)));
      return;
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [currentSelection, postContext, props.panel.pluginId, props.panel.pluginName]);

  useEffect(postContext, [postContext]);
  useEffect(() => {
    beginHandshake();
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [beginHandshake, reloadKey]);
  return (
    <section className={`${pluginTabHostStyles.panel} relative min-h-[360px] overflow-hidden p-0`}>
      {hostState !== "ready" ? (
        <div className="absolute inset-0 z-10 grid content-center justify-items-center gap-3 bg-charcoal-bg p-5 text-center text-sm text-cream-muted">
          {hostState === "loading" ? (
            <>
              <RefreshCcw className="animate-spin" size={20} />
              <span>Loading extension…</span>
            </>
          ) : (
            <>
              <Puzzle size={24} />
              <strong className="text-cream">Extension did not start</strong>
              <span>
                The panel bundle may be missing, outdated, or incompatible with this Misty version.
              </span>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  className={pluginTabHostStyles.button}
                  type="button"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  <RefreshCcw size={13} />
                  Retry
                </Button>
              </div>
              <code className="max-w-full overflow-hidden text-ellipsis text-[10px] text-cream-muted">
                {props.panel.webEntry}
              </code>
            </>
          )}
        </div>
      ) : null}
      <iframe
        key={reloadKey}
        ref={iframeRef}
        className="h-full min-h-[420px] w-full border-0 bg-charcoal-bg"
        src={source}
        title={`${props.panel.title} extension`}
        sandbox="allow-scripts allow-same-origin"
        onLoad={beginHandshake}
      />
    </section>
  );
}
