import { NativeAppView } from "@/features/apps/NativeAppView";
import { useNativeAppPermissions } from "@/features/apps/useNativeAppPermissions";
import { useAuth } from "@/features/auth";
import { extensionCommandRun, pluginPanelRender } from "@/features/files/native";
import { SystemErrorActivity } from "@/features/activity";
import { extensionThemeChangedEvent, extensionThemeSnapshot } from "@/features/settings";
import type {
  PluginPanelElement,
  PluginPanelEntry,
  PluginPanelRenderResult,
} from "@/native/contracts";
import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import { errorText } from "@/shared/lib/format";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { invoke } from "@tauri-apps/api/core";
import { Puzzle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectedPathsForPane, useExplorerStore } from "../../store";
import { pluginTabHostStyles } from "../ExplorerDesktopPluginStyles";
import { PluginPanelElementView } from "./PluginPanelElementView";
import { monitorExtensionJob } from "./extensionJobs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";

export function ExplorerPluginPanelHost(props: {
  panel: PluginPanelEntry;
  selectedPath: string;
  mode?: "embedded" | "app";
}) {
  if (props.panel.webEntry && props.panel.declarativeUi == null)
    return (
      <ExplorerWebPluginPanelHost
        mode={props.mode}
        panel={props.panel}
        selectedPath={props.selectedPath}
      />
    );
  return (
    <ExplorerNativePluginPanelHost
      mode={props.mode}
      panel={props.panel}
      selectedPath={props.selectedPath}
    />
  );
}

export function ExplorerNativePluginPanelHost(props: {
  panel: PluginPanelEntry;
  selectedPath: string;
  mode?: "embedded" | "app";
}) {
  const { user } = useAuth();
  const accountId = user?.id;
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const spaceId = activeScopeKey.startsWith("space:")
    ? activeScopeKey.slice("space:".length)
    : undefined;
  const permission = useNativeAppPermissions(props.panel.title);
  const permissionActions = useRef(permission);
  permissionActions.current = permission;
  const [widgetInstance, setWidgetInstance] = useState("");
  const [actionResult, setActionResult] = useState("");
  const [rendered, setRendered] = useState<PluginPanelRenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(rendering);

  const runWidgetAction = useCallback(
    async (instance: string, action: NonNullable<PluginPanelElement["action"]>) => {
      const execute = permissionActions.current.execute;
      if (action.method === "clipboard.writeText") {
        await execute(instance, action.method, { text: action.value });
        return "Copied to the clipboard.";
      }
      if (action.method === "clipboard.readText") {
        const result = (await execute(instance, action.method, {})) as { text?: string };
        return (result.text ?? "").slice(0, 4096) || "The clipboard contains no text.";
      }
      if (action.method === "network.fetch") {
        const result = (await execute(instance, action.method, {
          url: action.value,
          method: "GET",
        })) as { status?: number };
        return `Request completed with status ${result.status ?? "unknown"}.`;
      }
      if (action.method === "files.readText") {
        const chosen = (await execute(instance, "files.pick", {})) as
          | { handle: string; name: string }
          | null;
        if (!chosen) return "No file was chosen.";
        try {
          const result = (await execute(instance, "files.readText", {
            handle: chosen.handle,
          })) as { text?: string };
          return (result.text ?? "").slice(0, 4096) || `${chosen.name} contains no text.`;
        } finally {
          await execute(instance, "files.release", { handle: chosen.handle });
        }
      }
      throw new Error("Unsupported widget action.");
    },
    [],
  );

  const renderPanel = useCallback(
    (clickedButton = "") => {
      setRendering(true);
      setRenderError("");
      setActionResult("");
      void pluginPanelRender({
        panelId: props.panel.id,
        pluginId: props.panel.pluginId,
        selectedPaths: props.selectedPath ? [props.selectedPath] : [],
        clickedButton,
        inputs,
      })
        .then((result) => {
          setRendered(result);
          const action = result.elements.find((element) => element.id === clickedButton)?.action;
          if (action) {
            if (!widgetInstance) throw new Error("Widget permission session is not ready.");
            return runWidgetAction(widgetInstance, action).then(setActionResult);
          }
        })
        .catch((error) => setRenderError(errorText(error)))
        .finally(() => setRendering(false));
    },
    [
      inputs,
      props.panel.id,
      props.panel.pluginId,
      props.selectedPath,
      runWidgetAction,
      widgetInstance,
    ],
  );

  useEffect(() => {
    if (props.panel.declarativeUi == null) return;
    let disposed = false;
    let instance = "";
    setWidgetInstance("");
    setActionResult("");
    void invoke<string>("mini_widget_open", {
      request: {
        root: props.panel.pluginDir,
        owner: accountId ? { accountId, spaceId } : null,
      },
    })
      .then((opened) => {
        instance = opened;
        if (disposed) void invoke("mini_app_close", { instance: opened });
        else setWidgetInstance(opened);
      })
      .catch((caught) => !disposed && setRenderError(errorText(caught)));
    return () => {
      disposed = true;
      permissionActions.current.reset();
      if (instance) void invoke("mini_app_close", { instance }).catch(() => undefined);
    };
  }, [accountId, props.panel.declarativeUi, props.panel.pluginDir, spaceId]);

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
    <section
      className={
        props.mode === "app"
          ? `${pluginTabHostStyles.body} h-full min-h-0`
          : pluginTabHostStyles.panel
      }
    >
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
          disabled={rendering || (props.panel.declarativeUi != null && !widgetInstance)}
        >
          <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={13} />
          Refresh
        </Button>
      </header>
      {renderError ? (
        <SystemErrorActivity
          error={renderError}
          scope={`files:plugin-panel:${props.panel.id}`}
          title={
            props.mode === "app" ? "App could not be loaded" : "File panel could not be loaded"
          }
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      ) : null}
      {rendered && rendered.runtimeStatus !== "native_rendered" ? (
        <div className={pluginTabHostStyles.notice}>
          <Puzzle size={20} />
          <span>
            {rendered.message || (props.mode === "app" ? "App unavailable." : "Panel unavailable.")}
          </span>
        </div>
      ) : null}
      {!rendered && !renderError ? (
        <div className={pluginTabHostStyles.loading}>
          {props.mode === "app" ? "Loading app…" : "Loading panel…"}
        </div>
      ) : null}
      {rendered?.runtimeStatus === "native_rendered" ? (
        <div className={pluginTabHostStyles.elements}>
          {rendered.elements.map((element) => (
            <PluginPanelElementView
              key={element.id}
              element={element}
              value={inputs[element.id] ?? element.text}
              disabled={rendering || (element.action != null && !widgetInstance)}
              onInput={(value) => setInputs((current) => ({ ...current, [element.id]: value }))}
              onButton={() => renderPanel(element.id)}
            />
          ))}
        </div>
      ) : null}
      {actionResult ? <div className={pluginTabHostStyles.notice}>{actionResult}</div> : null}
      {permission.controls}
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
  mode?: "embedded" | "app";
}) {
  const { user } = useAuth();
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const spaceId = activeScopeKey.startsWith("space:")
    ? activeScopeKey.slice("space:".length)
    : undefined;
  const [theme, setTheme] = useState(extensionThemeSnapshot);
  const source = useMemo(() => webPanelUrl(props.panel), [props.panel]);
  const currentSelection = useCallback(() => {
    const selections = Object.values(useExplorerStore.getState().panes)
      .map(selectedPathsForPane)
      .find((paths) => paths.includes(props.selectedPath));
    return selections?.length ? selections : props.selectedPath ? [props.selectedPath] : [];
  }, [props.selectedPath]);
  const context = useMemo(
    () => ({
      channel: "misty-host",
      kind: "context",
      pluginId: props.panel.pluginId,
      selectedPaths: [
        "storage_report",
        "themes",
        "image_optimizer",
        "quick_convert",
        "backups",
        "ytdlp",
      ].includes(props.panel.pluginId)
        ? []
        : currentSelection(),
      theme,
    }),
    [currentSelection, props.panel.pluginId, theme],
  );
  useEffect(() => {
    const changed = () => setTheme(extensionThemeSnapshot());
    window.addEventListener(extensionThemeChangedEvent, changed);
    return () => {
      window.removeEventListener(extensionThemeChangedEvent, changed);
    };
  }, [props.panel.pluginId]);
  return (
    <section
      className={
        props.mode === "app"
          ? "relative h-full min-h-0 overflow-hidden bg-charcoal-bg"
          : `${pluginTabHostStyles.panel} relative min-h-[360px] overflow-hidden p-0`
      }
    >
      <NativeAppView
        key={`${user?.id ?? "signed-out"}:${spaceId ?? "global"}:${props.panel.pluginId}:${props.panel.id}`}
        source={source}
        owner={user ? { accountId: user.id, spaceId } : undefined}
        title={props.panel.title}
        context={context}
        onRequest={async (message) => {
          if (
            [
              "storage_report",
              "themes",
              "image_optimizer",
              "quick_convert",
              "backups",
              "ytdlp",
            ].includes(props.panel.pluginId)
          )
            throw new Error("This app uses the capability API. Update or reopen this app.");
          if (
            message.channel !== "misty-plugin" ||
            message.kind !== "request" ||
            typeof message.command !== "string"
          )
            throw new Error("Unsupported extension request.");
          const command = message.command;
          const payload =
            message.payload && typeof message.payload === "object"
              ? (message.payload as Record<string, unknown>)
              : {};
          // Identity comes from this panel's native registration, never message.pluginId.
          if (command === "host.selectedPaths")
            return { ok: true, selectedPaths: currentSelection() };
          if (command === "host.notify") {
            const level =
              payload.level === "success" || payload.level === "error" ? payload.level : "info";
            useExplorerStore
              .getState()
              .pushNotification(
                typeof payload.message === "string"
                  ? payload.message.slice(0, 500)
                  : "Extension notification",
                level,
                4500,
              );
            return { ok: true };
          }
          const result = await extensionCommandRun({
            pluginId: props.panel.pluginId,
            command,
            payload,
          });
          const started = result as { jobId?: string };
          if (typeof started.jobId === "string" && started.jobId)
            monitorExtensionJob(props.panel.pluginId, props.panel.pluginName, started.jobId);
          return result;
        }}
      />
    </section>
  );
}
