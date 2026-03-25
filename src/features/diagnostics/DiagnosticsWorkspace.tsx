import { useEffect, useState } from "react";
import { pluginDiagnosticsSnapshot } from "../../api/misty";
import type { AppEnvironmentSnapshot, PluginDiagnosticsSnapshot } from "../../api/types";
import { errorText } from "../../shared/format";

const diagnosticsGridClass =
  "m-[var(--misty-route-margin)] grid min-h-[calc(100vh-(var(--misty-route-margin)*2))] grid-cols-[minmax(280px,0.8fr)_minmax(420px,1.2fr)] gap-4 max-[980px]:grid-cols-1 max-[720px]:m-0 max-[720px]:min-h-full";

const diagnosticsLoadingClass =
  "empty m-[var(--misty-route-margin)] min-h-[calc(100vh-(var(--misty-route-margin)*2))] min-w-0 overflow-hidden rounded-xl border border-[var(--misty-border-soft)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--misty-surface-2)_92%,transparent),var(--misty-surface))] shadow-[0_18px_44px_var(--misty-shadow)] max-[720px]:m-0 max-[720px]:min-h-full";

const diagnosticsPanelClass =
  "min-w-0 overflow-hidden rounded-xl border border-[var(--misty-border-soft)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--misty-surface-2)_92%,transparent),var(--misty-surface))] shadow-[0_18px_44px_var(--misty-shadow)]";

const diagnosticsPanelHeaderClass =
  "flex items-center justify-between gap-4 border-b border-[var(--misty-border-soft)] px-[18px] py-4";

const kvListClass =
  "grid gap-px p-3";

const kvRowClass =
  "grid grid-cols-[minmax(150px,0.35fr)_minmax(0,1fr)] items-start gap-3.5 border-b border-[#1d2830] px-1.5 py-2.5 last:border-b-0";

export function DiagnosticsWorkspace(props: {
  environment: AppEnvironmentSnapshot | null;
  proxyStatus: string;
}) {
  const { environment, proxyStatus } = props;
  const [pluginDiagnostics, setPluginDiagnostics] = useState<PluginDiagnosticsSnapshot | null>(null);
  const [pluginDiagnosticsError, setPluginDiagnosticsError] = useState("");

  useEffect(() => {
    let canceled = false;
    void pluginDiagnosticsSnapshot()
      .then((snapshot) => {
        if (!canceled) {
          setPluginDiagnostics(snapshot);
          setPluginDiagnosticsError("");
        }
      })
      .catch((error) => {
        if (!canceled) setPluginDiagnosticsError(errorText(error));
      });
    return () => {
      canceled = true;
    };
  }, []);

  if (!environment) {
    return <section className={diagnosticsLoadingClass}>Loading diagnostics.</section>;
  }

  const pathRows = [
    ["Misty home", environment.mistyDir],
    ["Config", environment.mistyConfigPath],
    ["Settings", environment.settingsPath],
    ["Workspaces", environment.workspacesPath],
    ["Commands", environment.commandsPath],
    ["Database", environment.dbDir],
    ["Cache", environment.cacheDir],
    ["Temporary files", environment.tmpDir],
    ["Assets", environment.assetsDir],
    ["Public extensions", environment.pluginsPublicDir],
    ["Private extensions", environment.pluginsPrivateDir],
  ];

  return (
    <section className={diagnosticsGridClass}>
      <div className={`${diagnosticsPanelClass} col-span-full`}>
        <div className={diagnosticsPanelHeaderClass}>
          <div>
            <h2>Runtime</h2>
            <p>{proxyStatus}</p>
          </div>
        </div>
        <div className={kvListClass}>
          <KeyValue label="Remote runtime" value="Embedded" />
          <KeyValue label="Server URL" value={environment.serverUrl ?? "--"} />
          <KeyValue label="gRPC address" value={environment.grpcAddress} />
          <KeyValue label="Mount path" value={environment.mountPath} />
          <KeyValue label="Config exists" value={environment.configExists ? "Yes" : "No"} />
        </div>
      </div>

      <div className={diagnosticsPanelClass}>
        <div className={diagnosticsPanelHeaderClass}>
          <div>
            <h2>Paths</h2>
            <p>Shared Rust source of truth for migrated services.</p>
          </div>
        </div>
        <div className={kvListClass}>
          {pathRows.map(([label, value]) => (
            <KeyValue key={label} label={label} value={value} />
          ))}
        </div>
      </div>

      <div className={diagnosticsPanelClass}>
        <div className={diagnosticsPanelHeaderClass}>
          <div>
            <h2>Derived Env</h2>
            <p>Safe values derived from misty.json and process overrides.</p>
          </div>
        </div>
        <div className={kvListClass}>
          {Object.entries(environment.derivedEnv).map(([key, value]) => (
            <KeyValue key={key} label={key} value={value} />
          ))}
        </div>
      </div>

      <div className={`${diagnosticsPanelClass} col-span-full`}>
        <div className={diagnosticsPanelHeaderClass}>
          <div>
            <h2>Extensions</h2>
            <p>{pluginDiagnosticsError || `${pluginDiagnostics?.plugins.length ?? 0} installed extensions inspected.`}</p>
          </div>
          <button className="rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 py-2 text-sm text-[var(--misty-text)]" type="button" onClick={() => {
            setPluginDiagnosticsError("");
            void pluginDiagnosticsSnapshot()
              .then(setPluginDiagnostics)
              .catch((error) => setPluginDiagnosticsError(errorText(error)));
          }}>
            Refresh
          </button>
        </div>
        <div className={kvListClass}>
          <KeyValue label="Removed extensions" value={(pluginDiagnostics?.removedIds ?? ["git", "preview-panel"]).join(", ")} />
          {pluginDiagnostics?.plugins.length === 0 ? <KeyValue label="Installed" value="No installed extension commands or panels found." /> : null}
          {pluginDiagnostics?.plugins.map((plugin) => (
            <KeyValue
              key={`${plugin.pluginId}:${plugin.pluginDir}`}
              label={plugin.pluginName || plugin.pluginId}
              value={[
                plugin.enabled ? "enabled" : "disabled",
                plugin.runtimeStatus,
                `${plugin.commands.length} commands`,
                `${plugin.panels.length} panels`,
                plugin.missingDependencies.length ? `missing ${plugin.missingDependencies.join(", ")}` : "dependencies ok",
                plugin.errors.length ? `errors: ${plugin.errors.join("; ")}` : "",
              ].filter(Boolean).join(" · ")}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className={kvRowClass}>
      <span className="text-[#a9adb5]">{props.label}</span>
      <strong className="min-w-0 font-[520] text-[#f0eee9] [overflow-wrap:anywhere]">{props.value}</strong>
    </div>
  );
}
