import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Blocks, ExternalLink, Play, Puzzle, RefreshCcw, Terminal } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { pluginCommandRun, pluginCommandsSnapshot, pluginPanelRender } from "../../api/misty";
import type {
  PluginCommandEntry,
  PluginCommandsSnapshot,
  PluginPanelElement,
  PluginPanelEntry,
  PluginPanelRenderResult,
} from "../../api/types";
import { errorText } from "../../shared/format";
import { pluginCatalogChangedEvent } from "../plugins/pluginEvents";
import { publishPluginNotifications } from "../plugins/pluginNotifications";

const emptySnapshot: PluginCommandsSnapshot = {
  roots: [],
  commands: [],
  panels: [],
};

const dockStyles = {
  workspace:
    "m-[var(--misty-route-margin)] grid min-h-[calc(100vh-(var(--misty-route-margin)*2))] min-w-0 grid-cols-[minmax(250px,320px)_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-[var(--misty-border-soft)] bg-[radial-gradient(circle_at_0%_0%,color-mix(in_srgb,var(--misty-accent)_12%,transparent),transparent_30%),linear-gradient(180deg,var(--misty-bg),var(--misty-bg-soft))] max-[920px]:m-0 max-[920px]:min-h-full",
  launcher:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-r border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface)_78%,transparent)]",
  launcherHeader:
    "flex items-start justify-between gap-3 border-b border-[var(--misty-border-soft)] p-[18px]",
  launcherDescription: "text-[13px]",
  iconButton:
    "grid size-[34px] flex-none place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)]",
  panelList: "grid min-h-0 content-start gap-2 overflow-auto p-3",
  panelButton:
    "grid w-full min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 rounded-lg border border-transparent bg-transparent p-2.5 text-left text-[var(--misty-text-muted)] hover:border-[var(--misty-border-soft)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]",
  panelButtonActive:
    "border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-text)] shadow-[inset_3px_0_0_var(--misty-accent)]",
  panelTitle: "block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold",
  panelSubtitle:
    "mt-[3px] block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--misty-text-subtle)]",
  host: "min-h-0 min-w-0 overflow-auto p-[22px]",
  pluginHost: "grid max-w-[860px] gap-[18px]",
  pluginHeader:
    "flex items-start justify-between gap-4 border-b border-[var(--misty-border-soft)] pb-4",
  pluginBadge:
    "rounded-full border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 py-1.5 text-xs font-semibold text-[var(--misty-text-muted)]",
  panelSurface:
    "rounded-lg border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface-2)_84%,transparent)]",
  runtimeNotice:
    "grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-lg border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface-2)_84%,transparent)] p-4 text-[var(--misty-warning)]",
  runtimeHeading: "m-0 text-[15px] text-[var(--misty-text)]",
  runtimeText: "text-[13px] text-[var(--misty-text-muted)]",
  renderer:
    "grid gap-3 rounded-lg border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface-2)_84%,transparent)] p-3.5",
  rendererHeader: "flex items-center justify-between gap-3",
  rendererTitle: "m-0 text-[15px] text-[var(--misty-text)]",
  nativeButton:
    "inline-flex items-center justify-center gap-1.5 rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-3)] px-2.5 py-[7px] text-xs font-semibold text-[var(--misty-text)] disabled:cursor-progress disabled:opacity-70",
  elements: "flex min-h-20 flex-wrap items-center gap-[9px]",
  nestedElements: "flex min-h-0 flex-wrap items-center gap-[9px]",
  loadingElements: "flex min-h-20 flex-wrap items-center gap-[9px] [&>span]:h-3.5 [&>span]:w-full [&>span]:animate-[shimmer_1.3s_ease-in-out_infinite] [&>span]:rounded-[5px] [&>span]:bg-[linear-gradient(90deg,var(--misty-surface-3),var(--misty-surface-4),var(--misty-surface-3))] [&>span]:bg-[length:200%_100%]",
  pluginText:
    "m-0 basis-full text-sm leading-[1.45] text-[var(--misty-text)]",
  pluginTextWrapped:
    "m-0 basis-full text-sm leading-[1.45] text-[var(--misty-text-muted)]",
  separator: "my-1 w-full basis-full border-0 border-t border-[var(--misty-border-soft)]",
  spacing: "h-[3px] basis-full",
  row:
    "inline-flex flex-wrap items-center gap-[9px] [&_.dock-flex-item]:basis-auto",
  nativeInput:
    "min-w-[min(280px,100%)] rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-1)] px-2.5 py-2 text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)] disabled:cursor-progress disabled:opacity-70",
  child: "min-h-px max-w-full basis-full",
  childBordered:
    "min-h-px max-w-full basis-full rounded-[7px] border border-[var(--misty-border-soft)] p-2",
  image:
    "grid min-h-12 min-w-20 place-items-center rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-1)] text-xs text-[var(--misty-text-subtle)]",
  notification:
    "grid gap-0.5 rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-1)] px-2.5 py-[9px] text-xs text-[var(--misty-text-muted)] [&>strong]:capitalize [&>strong]:text-[var(--misty-text)]",
  notificationSuccess:
    "border-[color-mix(in_srgb,var(--misty-success)_45%,var(--misty-border-soft))]",
  notificationError:
    "border-[color-mix(in_srgb,var(--misty-danger)_45%,var(--misty-border-soft))]",
  details:
    "grid grid-cols-[140px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface-2)_84%,transparent)]",
  detailTerm:
    "m-0 min-w-0 border-b border-[var(--misty-border-soft)] px-[13px] py-[11px] text-xs font-bold uppercase text-[var(--misty-text-subtle)]",
  detailValue:
    "m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap border-b border-[var(--misty-border-soft)] px-[13px] py-[11px] text-[var(--misty-text-muted)]",
  commands:
    "grid gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface-2)_84%,transparent)] p-3.5",
  commandHeading: "m-0 text-[15px] text-[var(--misty-text)]",
  commandRow:
    "grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t border-[var(--misty-border-soft)] pt-2",
  commandLabel: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  commandMeta: "text-[var(--misty-text-subtle)]",
  commandWarning:
    "whitespace-nowrap text-[11px] not-italic font-semibold text-[var(--misty-warning)]",
  link:
    "inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-primary)] px-3 py-[9px] font-semibold text-[var(--misty-primary-contrast)] no-underline",
  empty:
    "grid place-items-center gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface-2)_84%,transparent)] px-[18px] py-7 text-center text-[var(--misty-text-muted)]",
  hostEmpty:
    "grid min-h-[360px] place-items-center gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface-2)_84%,transparent)] px-[18px] py-7 text-center text-[var(--misty-text-muted)]",
  error:
    "m-3 rounded-lg border border-[color-mix(in_srgb,var(--misty-danger)_48%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-danger)_12%,var(--misty-surface))] px-3 py-2.5 text-[13px] text-[var(--misty-danger)]",
  message:
    "m-3 rounded-lg border border-[color-mix(in_srgb,var(--misty-success)_38%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-success)_10%,var(--misty-surface))] px-3 py-2.5 text-[13px] text-[var(--misty-success)]",
  skeleton:
    "grid gap-[9px] p-3 [&>span]:h-[54px] [&>span]:animate-[shimmer_1.3s_ease-in-out_infinite] [&>span]:rounded-lg [&>span]:bg-[linear-gradient(90deg,var(--misty-surface-2),var(--misty-surface-3),var(--misty-surface-2))] [&>span]:bg-[length:220%_100%]",
} as const;

export function DockWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState<PluginCommandsSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedPanelId = searchParams.get("panel") ?? "";
  const selectedPluginId = searchParams.get("plugin") ?? "";
  const selectedPath = searchParams.get("selected") ?? "";

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void pluginCommandsSnapshot()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
      })
      .catch((error) => setError(errorText(error)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    window.addEventListener(pluginCatalogChangedEvent, load);
    return () => window.removeEventListener(pluginCatalogChangedEvent, load);
  }, [load]);

  const dockPanels = useMemo(() => panelsForDockLauncher(snapshot.panels), [snapshot.panels]);
  const selectedPanel = useMemo(
    () => panelForRoute(snapshot.panels, dockPanels, selectedPanelId, selectedPluginId),
    [dockPanels, selectedPanelId, selectedPluginId, snapshot.panels],
  );
  const commandsByPlugin = useMemo(() => commandsGroupedByPlugin(snapshot.commands), [snapshot.commands]);
  const commandOnlyGroups = useMemo(
    () => commandOnlyPluginGroups(snapshot.commands, dockPanels),
    [dockPanels, snapshot.commands],
  );
  const selectedCommandGroup = !selectedPanel && selectedPluginId
    ? commandOnlyGroups.find((group) => group.pluginId === selectedPluginId) ?? null
    : null;
  const navigate = useNavigate();

  const runCommand = useCallback((command: PluginCommandEntry) => {
    if (pluginCommandNeedsSelection(command, selectedPath)) {
      setError(`${command.label}: Select a file in Explorer before running this command.`);
      return;
    }
    setRunningCommandId(command.id);
    setError(null);
    setMessage(null);
    void pluginCommandRun({
      commandId: command.id,
      selectedPaths: selectedPath ? [selectedPath] : [],
    })
      .then((result) => {
        if (result.targetRoute) navigate(result.targetRoute);
        if (result.handled) {
          publishPluginNotifications(result.notifications, result.message);
          setMessage(result.message);
        } else {
          setError(`${command.label}: ${result.message}`);
        }
      })
      .catch((error) => setError(errorText(error)))
      .finally(() => setRunningCommandId(null));
  }, [navigate, selectedPath]);

  useEffect(() => {
    if (!selectedPanelId && selectedPanel) {
      setSearchParams(dockPanelSearchParams(selectedPanel, selectedPath), { replace: true });
    } else if (!selectedPanelId && !selectedPluginId && !selectedPanel && commandOnlyGroups[0]) {
      setSearchParams(dockCommandSearchParams(commandOnlyGroups[0], selectedPath), { replace: true });
    }
  }, [commandOnlyGroups, selectedPanel, selectedPanelId, selectedPath, selectedPluginId, setSearchParams]);

  return (
    <section className={dockStyles.workspace}>
      <aside className={dockStyles.launcher} aria-label="Extension panels">
        <header className={dockStyles.launcherHeader}>
          <div>
            <h2>Extensions</h2>
            <p className={dockStyles.launcherDescription}>Dock panels from installed extensions.</p>
          </div>
          <button className={dockStyles.iconButton} type="button" title="Refresh extensions" onClick={load}>
            <RefreshCcw size={16} />
          </button>
        </header>
        {loading ? <DockSkeleton /> : null}
        {error ? <div className={dockStyles.error}>{error}</div> : null}
        {message ? <div className={dockStyles.message}>{message}</div> : null}
        {!loading && dockPanels.length === 0 && commandOnlyGroups.length === 0 ? (
          <div className={dockStyles.empty}>
            <Puzzle size={26} />
            <p>No installed extension panels or commands were discovered.</p>
          </div>
        ) : (
          <div className={dockStyles.panelList}>
            {dockPanels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                className={`${dockStyles.panelButton} ${panel.id === selectedPanel?.id ? dockStyles.panelButtonActive : ""}`}
                onClick={() => setSearchParams(dockPanelSearchParams(panel, selectedPath))}
              >
                <Blocks size={17} />
                <span>
                  <strong className={dockStyles.panelTitle}>{panel.title}</strong>
                  <small className={dockStyles.panelSubtitle}>{panel.pluginName}</small>
                </span>
              </button>
            ))}
            {commandOnlyGroups.map((group) => (
              <button
                key={group.pluginId}
                type="button"
                className={`${dockStyles.panelButton} ${!selectedPanel && group.pluginId === selectedCommandGroup?.pluginId ? dockStyles.panelButtonActive : ""}`}
                onClick={() => setSearchParams(dockCommandSearchParams(group, selectedPath))}
              >
                <Terminal size={17} />
                <span>
                  <strong className={dockStyles.panelTitle}>{group.pluginName}</strong>
                  <small className={dockStyles.panelSubtitle}>{group.commands.length} command{group.commands.length === 1 ? "" : "s"}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <main className={dockStyles.host}>
        {selectedPanel ? (
          <PluginPanelHost
            panel={selectedPanel}
            commands={commandsByPlugin.get(selectedPanel.pluginId) ?? []}
            runningCommandId={runningCommandId}
            selectedPath={selectedPath}
            onRunCommand={runCommand}
          />
        ) : selectedCommandGroup ? (
          <PluginCommandOnlyHost
            group={selectedCommandGroup}
            runningCommandId={runningCommandId}
            selectedPath={selectedPath}
            onRunCommand={runCommand}
          />
        ) : (
          <div className={dockStyles.hostEmpty}>
            <h2>Extensions</h2>
            <p>Install an extension with panels or commands to use the Dock workspace.</p>
          </div>
        )}
      </main>
    </section>
  );
}

const PluginPanelHost = memo(function PluginPanelHost(props: {
  panel: PluginPanelEntry;
  commands: PluginCommandEntry[];
  runningCommandId: string | null;
  selectedPath: string;
  onRunCommand: (command: PluginCommandEntry) => void;
}) {
  const [rendered, setRendered] = useState<PluginPanelRenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const renderPanel = useCallback((clickedButton = "") => {
    setRendering(true);
    setRenderError(null);
    void pluginPanelRender({
      panelId: props.panel.id,
      pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
      clickedButton,
      inputs,
    })
      .then((result) => {
        setRendered(result);
        publishPluginNotifications(result.notifications);
      })
      .catch((error) => setRenderError(errorText(error)))
      .finally(() => setRendering(false));
  }, [inputs, props.panel.id, props.panel.pluginId, props.selectedPath]);

  useEffect(() => {
    setInputs({});
    setRendered(null);
    setRendering(true);
    setRenderError(null);
    void pluginPanelRender({
      panelId: props.panel.id,
      pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
    })
      .then((result) => {
        setRendered(result);
        publishPluginNotifications(result.notifications);
      })
      .catch((error) => setRenderError(errorText(error)))
      .finally(() => setRendering(false));
  }, [props.panel.id, props.panel.pluginId, props.selectedPath]);

  const updateInput = useCallback((id: string, value: string) => {
    setInputs((current) => ({ ...current, [id]: value }));
  }, []);

  return (
    <article className={dockStyles.pluginHost}>
      <header className={dockStyles.pluginHeader}>
        <div>
          <h2>{props.panel.title}</h2>
          <p>{props.panel.pluginName}</p>
        </div>
        <span className={dockStyles.pluginBadge}>{props.panel.windowType || "panel"}</span>
      </header>
      <section className={dockStyles.renderer} aria-busy={rendering}>
        <header className={dockStyles.rendererHeader}>
          <h3 className={dockStyles.rendererTitle}>{rendered?.title ?? props.panel.title}</h3>
          <button className={dockStyles.nativeButton} type="button" onClick={() => renderPanel()} disabled={rendering}>
            <RefreshCcw size={13} />
            Refresh
          </button>
        </header>
        {renderError ? <div className={dockStyles.error}>{renderError}</div> : null}
        {rendered?.notifications.map((notification, index) => (
          <div
            key={`${notification.level}-${index}`}
            className={`${dockStyles.notification} ${notificationLevelClass(notification.level)}`}
          >
            <strong>{notification.title || notification.level}</strong>
            {notification.message ? <span>{notification.message}</span> : null}
          </div>
        ))}
        {rendered && rendered.runtimeStatus !== "native_rendered" ? (
          <div className={dockStyles.runtimeNotice}>
            <Puzzle size={22} />
            <div>
              <h3 className={dockStyles.runtimeHeading}>Extension panel unavailable</h3>
              <p className={dockStyles.runtimeText}>{rendered.message}</p>
            </div>
          </div>
        ) : null}
        {!rendered && !renderError ? <DockPanelSkeleton /> : null}
        {rendered?.runtimeStatus === "native_rendered" ? (
          <PluginPanelLayoutView
            nodes={buildPanelLayout(rendered.elements)}
            values={inputs}
            disabled={rendering}
            onInput={updateInput}
            onButton={(buttonId) => renderPanel(buttonId)}
          />
        ) : null}
      </section>
      <dl className={dockStyles.details}>
        <dt className={dockStyles.detailTerm}>Panel ID</dt>
        <dd className={dockStyles.detailValue}>{props.panel.id}</dd>
        <dt className={dockStyles.detailTerm}>Extension ID</dt>
        <dd className={dockStyles.detailValue}>{props.panel.pluginId}</dd>
        <dt className={dockStyles.detailTerm}>Default size</dt>
        <dd className={dockStyles.detailValue}>{Math.round(props.panel.defaultWidth)} x {Math.round(props.panel.defaultHeight)}</dd>
        <dt className={dockStyles.detailTerm}>Views</dt>
        <dd className={dockStyles.detailValue}>{extensionViewLabels(props.panel.launcherViews).join(", ") || "Extensions"}</dd>
        <dt className={dockStyles.detailTerm}>Library</dt>
        <dd className={dockStyles.detailValue}>{props.panel.libraryPath || "No platform runtime library advertised"}</dd>
        <dt className={dockStyles.detailTerm}>Manifest</dt>
        <dd className={dockStyles.detailValue}>{props.panel.manifestPath || "No manifest path"}</dd>
      </dl>
      {props.commands.length > 0 ? (
        <section className={dockStyles.commands}>
          <h3 className={dockStyles.commandHeading}>Commands</h3>
          {props.commands.map((command) => (
            <div key={command.id} className={dockStyles.commandRow}>
              <span className={dockStyles.commandLabel} title={command.hint}>{command.label}</span>
              <small className={dockStyles.commandMeta}>{command.defaultShortcut || command.source}</small>
              {pluginCommandNeedsSelection(command, props.selectedPath) ? (
                <em className={dockStyles.commandWarning}>Select a file first</em>
              ) : null}
              <button
                className={dockStyles.nativeButton}
                type="button"
                disabled={props.runningCommandId === command.id || pluginCommandNeedsSelection(command, props.selectedPath)}
                onClick={() => props.onRunCommand(command)}
                title={pluginCommandNeedsSelection(command, props.selectedPath)
                  ? "Select a file in Explorer before running this command"
                  : `Run ${command.label}`}
              >
                <Play size={13} />
                {props.runningCommandId === command.id ? "Running" : "Run"}
              </button>
            </div>
          ))}
        </section>
      ) : null}
      <Link className={dockStyles.link} to={`/hub/extensions?plugin=${encodeURIComponent(props.panel.pluginId)}`}>
        Manage in Hub
        <ExternalLink size={14} />
      </Link>
    </article>
  );
});

const PluginCommandOnlyHost = memo(function PluginCommandOnlyHost(props: {
  group: PluginCommandGroup;
  runningCommandId: string | null;
  selectedPath: string;
  onRunCommand: (command: PluginCommandEntry) => void;
}) {
  return (
    <article className={dockStyles.pluginHost}>
      <header className={dockStyles.pluginHeader}>
        <div>
          <h2>{props.group.pluginName}</h2>
          <p>{props.group.commands.length} installed command{props.group.commands.length === 1 ? "" : "s"}</p>
        </div>
        <span className={dockStyles.pluginBadge}>commands</span>
      </header>
      <section className={dockStyles.runtimeNotice}>
        <Terminal size={22} />
        <div>
          <h3 className={dockStyles.runtimeHeading}>Command-only extension</h3>
          <p className={dockStyles.runtimeText}>
            {props.selectedPath
              ? `Commands will run with ${props.selectedPath}.`
              : "Select a file in Explorer before running commands that require a selection."}
          </p>
        </div>
      </section>
      <section className={dockStyles.commands}>
        <h3 className={dockStyles.commandHeading}>Commands</h3>
        {props.group.commands.map((command) => (
          <div key={command.id} className={dockStyles.commandRow}>
            <span className={dockStyles.commandLabel} title={command.hint}>{command.label}</span>
            <small className={dockStyles.commandMeta}>{command.defaultShortcut || command.source}</small>
            {pluginCommandNeedsSelection(command, props.selectedPath) ? (
              <em className={dockStyles.commandWarning}>Select a file first</em>
            ) : null}
            <button
              className={dockStyles.nativeButton}
              type="button"
              disabled={props.runningCommandId === command.id || pluginCommandNeedsSelection(command, props.selectedPath)}
              onClick={() => props.onRunCommand(command)}
              title={pluginCommandNeedsSelection(command, props.selectedPath)
                ? "Select a file in Explorer before running this command"
                : `Run ${command.label}`}
            >
              <Play size={13} />
              {props.runningCommandId === command.id ? "Running" : "Run"}
            </button>
          </div>
        ))}
      </section>
      <Link className={dockStyles.link} to={`/hub/extensions?plugin=${encodeURIComponent(props.group.pluginId)}`}>
        Manage in Hub
        <ExternalLink size={14} />
      </Link>
    </article>
  );
});

const PluginPanelElementView = memo(function PluginPanelElementView(props: {
  element: PluginPanelElement;
  value: string;
  disabled: boolean;
  onButton: (buttonId: string) => void;
  onInput: (id: string, value: string) => void;
}) {
  const element = props.element;
  switch (element.kind) {
    case "text":
      return <p className={`${dockStyles.pluginText} dock-flex-item`}>{element.text}</p>;
    case "textWrapped":
      return <p className={`${dockStyles.pluginTextWrapped} dock-flex-item`}>{element.text}</p>;
    case "separator":
      return <hr className={`${dockStyles.separator} dock-flex-item`} />;
    case "spacing":
      return <div className={`${dockStyles.spacing} dock-flex-item`} aria-hidden="true" />;
    case "button":
      return (
        <button
          className={dockStyles.nativeButton}
          type="button"
          disabled={props.disabled}
          style={buttonSizeStyle(element)}
          onClick={() => props.onButton(element.id || element.text)}
        >
          {element.text}
        </button>
      );
    case "inputText":
      return (
        <input
          className={dockStyles.nativeInput}
          value={props.value}
          disabled={props.disabled}
          aria-label={element.id || "Extension input"}
          onChange={(event) => props.onInput(element.id, event.target.value)}
        />
      );
    case "beginChild":
    case "endChild":
    case "sameLine":
      return null;
    case "image":
      return <div className={dockStyles.image} style={buttonSizeStyle(element)}>Texture {element.id}</div>;
    default:
      return element.text ? <p className={`${dockStyles.pluginText} dock-flex-item`}>{element.text}</p> : null;
  }
});

type PluginPanelLayoutNode =
  | { kind: "element"; element: PluginPanelElement }
  | { kind: "child"; element: PluginPanelElement; children: PluginPanelLayoutNode[] }
  | { kind: "row"; children: PluginPanelLayoutNode[] };

const PluginPanelLayoutView = memo(function PluginPanelLayoutView(props: {
  nodes: PluginPanelLayoutNode[];
  values: Record<string, string>;
  disabled: boolean;
  onButton: (buttonId: string) => void;
  onInput: (id: string, value: string) => void;
}) {
  return (
    <div className={dockStyles.elements}>
      {props.nodes.map((node, index) => (
        <PluginPanelLayoutNodeView
          key={panelLayoutNodeKey(node, index)}
          node={node}
          values={props.values}
          disabled={props.disabled}
          onButton={props.onButton}
          onInput={props.onInput}
        />
      ))}
    </div>
  );
});

const PluginPanelLayoutNodeView = memo(function PluginPanelLayoutNodeView(props: {
  node: PluginPanelLayoutNode;
  values: Record<string, string>;
  disabled: boolean;
  onButton: (buttonId: string) => void;
  onInput: (id: string, value: string) => void;
}) {
  if (props.node.kind === "row") {
    return (
      <div className={dockStyles.row}>
        {props.node.children.map((child, index) => (
          <PluginPanelLayoutNodeView
            key={panelLayoutNodeKey(child, index)}
            node={child}
            values={props.values}
            disabled={props.disabled}
            onButton={props.onButton}
            onInput={props.onInput}
          />
        ))}
      </div>
    );
  }
  if (props.node.kind === "child") {
    return (
      <div
        className={props.node.element.border ? dockStyles.childBordered : dockStyles.child}
        style={panelElementBoxStyle(props.node.element)}
      >
        <div className={dockStyles.nestedElements}>
          {props.node.children.map((child, index) => (
            <PluginPanelLayoutNodeView
              key={panelLayoutNodeKey(child, index)}
              node={child}
              values={props.values}
              disabled={props.disabled}
              onButton={props.onButton}
              onInput={props.onInput}
            />
          ))}
        </div>
      </div>
    );
  }
  const element = props.node.element;
  return (
    <PluginPanelElementView
      element={element}
      value={props.values[element.id] ?? element.text}
      disabled={props.disabled}
      onInput={props.onInput}
      onButton={props.onButton}
    />
  );
});

function buildPanelLayout(elements: PluginPanelElement[]): PluginPanelLayoutNode[] {
  return buildPanelLayoutRange(elements, 0).nodes;
}

function buildPanelLayoutRange(
  elements: PluginPanelElement[],
  startIndex: number,
): { nodes: PluginPanelLayoutNode[]; nextIndex: number } {
  const nodes: PluginPanelLayoutNode[] = [];
  let sameLinePending = false;
  let index = startIndex;

  while (index < elements.length) {
    const element = elements[index];
    index += 1;

    if (element.kind === "endChild") {
      break;
    }
    if (element.kind === "sameLine") {
      sameLinePending = true;
      continue;
    }

    let node: PluginPanelLayoutNode;
    if (element.kind === "beginChild") {
      const nested = buildPanelLayoutRange(elements, index);
      index = nested.nextIndex;
      node = { kind: "child", element, children: nested.nodes };
    } else {
      node = { kind: "element", element };
    }

    if (sameLinePending && nodes.length > 0) {
      const previous = nodes.pop();
      if (previous) nodes.push(appendPanelRowNode(previous, node));
    } else {
      nodes.push(node);
    }
    sameLinePending = false;
  }

  return { nodes, nextIndex: index };
}

function appendPanelRowNode(previous: PluginPanelLayoutNode, next: PluginPanelLayoutNode): PluginPanelLayoutNode {
  if (previous.kind === "row") {
    return { kind: "row", children: [...previous.children, next] };
  }
  return { kind: "row", children: [previous, next] };
}

function panelLayoutNodeKey(node: PluginPanelLayoutNode, index: number): string {
  if (node.kind === "row") return `row-${index}`;
  return `${node.kind}-${node.element.kind}-${node.element.id}-${node.element.text}-${index}`;
}

function DockPanelSkeleton() {
  return (
    <div className={dockStyles.loadingElements} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function buttonSizeStyle(element: PluginPanelElement) {
  return {
    width: element.width > 0 ? `${Math.round(element.width)}px` : undefined,
    minHeight: element.height > 0 ? `${Math.round(element.height)}px` : undefined,
  };
}

function panelElementBoxStyle(element: PluginPanelElement): CSSProperties {
  return {
    width: element.width > 0 ? `${Math.round(element.width)}px` : undefined,
    minHeight: element.height > 0 ? `${Math.round(element.height)}px` : undefined,
  };
}

function DockSkeleton() {
  return (
    <div className={dockStyles.skeleton} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function commandsGroupedByPlugin(commands: PluginCommandEntry[]) {
  const grouped = new Map<string, PluginCommandEntry[]>();
  for (const command of commands) {
    const list = grouped.get(command.pluginId) ?? [];
    list.push(command);
    grouped.set(command.pluginId, list);
  }
  return grouped;
}

type PluginCommandGroup = {
  pluginId: string;
  pluginName: string;
  commands: PluginCommandEntry[];
};

function commandOnlyPluginGroups(
  commands: PluginCommandEntry[],
  dockPanels: PluginPanelEntry[],
): PluginCommandGroup[] {
  const pluginsWithDockPanels = new Set(dockPanels.map((panel) => panel.pluginId));
  const grouped = commandsGroupedByPlugin(commands.filter((command) =>
    !pluginsWithDockPanels.has(command.pluginId) && !pluginCommandOnlyOpensLauncher(command)
  ));
  return Array.from(grouped.entries())
    .map(([pluginId, groupCommands]) => ({
      pluginId,
      pluginName: groupCommands[0]?.pluginName ?? pluginId,
      commands: groupCommands,
    }))
    .filter((group) => group.commands.length > 0)
    .sort((left, right) => left.pluginName.localeCompare(right.pluginName));
}

function pluginCommandOnlyOpensLauncher(command: PluginCommandEntry): boolean {
  if (command.source === "launcher" || command.actionKind === "open") return true;
  const label = command.label.trim();
  return label === "Open" || label.endsWith(": Open");
}

function pluginCommandNeedsSelection(command: PluginCommandEntry, selectedPath: string): boolean {
  return command.requiresSelectedFile && !selectedPath.trim();
}

function extensionViewLabels(views: string[]): string[] {
  return views.map((view) => view.trim().toLowerCase() === "plugins" ? "Extensions" : view);
}

function notificationLevelClass(level: string): string {
  if (level === "success") return dockStyles.notificationSuccess;
  if (level === "error") return dockStyles.notificationError;
  return "";
}

function panelForRoute(
  panels: PluginPanelEntry[],
  fallbackPanels: PluginPanelEntry[],
  panelId: string,
  pluginId: string,
): PluginPanelEntry | null {
  if (panelId) {
    return panels.find((panel) =>
      panel.id === panelId && (!pluginId || panel.pluginId === pluginId)
    ) ?? null;
  }
  if (pluginId) {
    return panels.find((panel) => panel.pluginId === pluginId) ?? null;
  }
  return fallbackPanels[0] ?? null;
}

function panelsForDockLauncher(panels: PluginPanelEntry[]): PluginPanelEntry[] {
  return panels.filter((panel) =>
    panel.launcherViews.some((view) => view.trim().toLowerCase() === "dock")
  );
}

function dockPanelSearchParams(panel: PluginPanelEntry, selectedPath: string): Record<string, string> {
  const params: Record<string, string> = {
    plugin: panel.pluginId,
    panel: panel.id,
  };
  if (selectedPath) params.selected = selectedPath;
  return params;
}

function dockCommandSearchParams(group: PluginCommandGroup, selectedPath: string): Record<string, string> {
  const params: Record<string, string> = {
    plugin: group.pluginId,
  };
  if (selectedPath) params.selected = selectedPath;
  return params;
}
