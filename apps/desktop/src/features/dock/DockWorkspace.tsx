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
    <section className="dock-workspace">
      <aside className="dock-launcher" aria-label="Plugin panels">
        <header>
          <div>
            <h2>Plugins</h2>
            <p>Dock panels from installed plugins.</p>
          </div>
          <button type="button" title="Refresh plugins" onClick={load}>
            <RefreshCcw size={16} />
          </button>
        </header>
        {loading ? <DockSkeleton /> : null}
        {error ? <div className="dock-error">{error}</div> : null}
        {message ? <div className="dock-message">{message}</div> : null}
        {!loading && dockPanels.length === 0 && commandOnlyGroups.length === 0 ? (
          <div className="dock-empty">
            <Puzzle size={26} />
            <p>No installed plugin panels or commands were discovered.</p>
          </div>
        ) : (
          <div className="dock-panel-list">
            {dockPanels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                className={panel.id === selectedPanel?.id ? "active" : undefined}
                onClick={() => setSearchParams(dockPanelSearchParams(panel, selectedPath))}
              >
                <Blocks size={17} />
                <span>
                  <strong>{panel.title}</strong>
                  <small>{panel.pluginName}</small>
                </span>
              </button>
            ))}
            {commandOnlyGroups.map((group) => (
              <button
                key={group.pluginId}
                type="button"
                className={!selectedPanel && group.pluginId === selectedCommandGroup?.pluginId ? "active" : undefined}
                onClick={() => setSearchParams(dockCommandSearchParams(group, selectedPath))}
              >
                <Terminal size={17} />
                <span>
                  <strong>{group.pluginName}</strong>
                  <small>{group.commands.length} command{group.commands.length === 1 ? "" : "s"}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <main className="dock-host">
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
          <div className="dock-host-empty">
            <h2>Plugins</h2>
            <p>Install a plugin with panels or commands to use the Dock workspace.</p>
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
    <article className="dock-plugin-host">
      <header>
        <div>
          <h2>{props.panel.title}</h2>
          <p>{props.panel.pluginName}</p>
        </div>
        <span>{props.panel.windowType || "panel"}</span>
      </header>
      <section className="dock-plugin-renderer" aria-busy={rendering}>
        <header>
          <h3>{rendered?.title ?? props.panel.title}</h3>
          <button type="button" onClick={() => renderPanel()} disabled={rendering}>
            <RefreshCcw size={13} />
            Refresh
          </button>
        </header>
        {renderError ? <div className="dock-error">{renderError}</div> : null}
        {rendered?.notifications.map((notification, index) => (
          <div key={`${notification.level}-${index}`} className={`dock-plugin-notification ${notification.level}`}>
            <strong>{notification.title || notification.level}</strong>
            {notification.message ? <span>{notification.message}</span> : null}
          </div>
        ))}
        {rendered && rendered.runtimeStatus !== "native_rendered" ? (
          <div className="dock-runtime-notice">
            <Puzzle size={22} />
            <div>
              <h3>Plugin panel unavailable</h3>
              <p>{rendered.message}</p>
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
      <dl className="dock-plugin-details">
        <dt>Panel ID</dt>
        <dd>{props.panel.id}</dd>
        <dt>Plugin ID</dt>
        <dd>{props.panel.pluginId}</dd>
        <dt>Default size</dt>
        <dd>{Math.round(props.panel.defaultWidth)} x {Math.round(props.panel.defaultHeight)}</dd>
        <dt>Views</dt>
        <dd>{props.panel.launcherViews.join(", ") || "Plugins"}</dd>
        <dt>Library</dt>
        <dd>{props.panel.libraryPath || "No platform runtime library advertised"}</dd>
        <dt>Manifest</dt>
        <dd>{props.panel.manifestPath || "No manifest path"}</dd>
      </dl>
      {props.commands.length > 0 ? (
        <section className="dock-plugin-commands">
          <h3>Commands</h3>
          {props.commands.map((command) => (
            <div key={command.id}>
              <span title={command.hint}>{command.label}</span>
              <small>{command.defaultShortcut || command.source}</small>
              {pluginCommandNeedsSelection(command, props.selectedPath) ? (
                <em>Select a file first</em>
              ) : null}
              <button
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
      <Link className="dock-plugin-link" to={`/hub/plugins?plugin=${encodeURIComponent(props.panel.pluginId)}`}>
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
    <article className="dock-plugin-host">
      <header>
        <div>
          <h2>{props.group.pluginName}</h2>
          <p>{props.group.commands.length} installed command{props.group.commands.length === 1 ? "" : "s"}</p>
        </div>
        <span>commands</span>
      </header>
      <section className="dock-runtime-notice command-only">
        <Terminal size={22} />
        <div>
          <h3>Command-only plugin</h3>
          <p>
            {props.selectedPath
              ? `Commands will run with ${props.selectedPath}.`
              : "Select a file in Explorer before running commands that require a selection."}
          </p>
        </div>
      </section>
      <section className="dock-plugin-commands command-only">
        <h3>Commands</h3>
        {props.group.commands.map((command) => (
          <div key={command.id}>
            <span title={command.hint}>{command.label}</span>
            <small>{command.defaultShortcut || command.source}</small>
            {pluginCommandNeedsSelection(command, props.selectedPath) ? (
              <em>Select a file first</em>
            ) : null}
            <button
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
      <Link className="dock-plugin-link" to={`/hub/plugins?plugin=${encodeURIComponent(props.group.pluginId)}`}>
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
      return <p className="dock-plugin-text">{element.text}</p>;
    case "textWrapped":
      return <p className="dock-plugin-text wrapped">{element.text}</p>;
    case "separator":
      return <hr className="dock-plugin-separator" />;
    case "spacing":
      return <div className="dock-plugin-spacing" aria-hidden="true" />;
    case "button":
      return (
        <button
          className="dock-plugin-native-button"
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
          className="dock-plugin-native-input"
          value={props.value}
          disabled={props.disabled}
          aria-label={element.id || "Plugin input"}
          onChange={(event) => props.onInput(element.id, event.target.value)}
        />
      );
    case "beginChild":
    case "endChild":
    case "sameLine":
      return null;
    case "image":
      return <div className="dock-plugin-image" style={buttonSizeStyle(element)}>Texture {element.id}</div>;
    default:
      return element.text ? <p className="dock-plugin-text">{element.text}</p> : null;
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
    <div className="dock-plugin-elements">
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
      <div className="dock-plugin-row">
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
        className={`dock-plugin-child${props.node.element.border ? " bordered" : ""}`}
        style={panelElementBoxStyle(props.node.element)}
      >
        <div className="dock-plugin-elements nested">
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
    <div className="dock-plugin-elements loading" aria-hidden="true">
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
    <div className="dock-skeleton" aria-hidden="true">
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
