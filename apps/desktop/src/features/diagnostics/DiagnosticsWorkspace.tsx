import type { AppEnvironmentSnapshot } from "../../api/types";

export function DiagnosticsWorkspace(props: {
  environment: AppEnvironmentSnapshot | null;
  proxyStatus: string;
}) {
  const { environment, proxyStatus } = props;
  if (!environment) {
    return <section className="panel diagnostics-panel empty">Loading diagnostics.</section>;
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
    ["Public plugins", environment.pluginsPublicDir],
    ["Private plugins", environment.pluginsPrivateDir],
  ];

  return (
    <section className="diagnostics-grid">
      <div className="panel diagnostics-panel">
        <div className="panel-header">
          <div>
            <h2>Runtime</h2>
            <p>{proxyStatus}</p>
          </div>
        </div>
        <div className="kv-list">
          <KeyValue label="Proxy URL" value={environment.proxyUrl ?? "--"} />
          <KeyValue label="Server URL" value={environment.serverUrl ?? "--"} />
          <KeyValue label="gRPC address" value={environment.grpcAddress} />
          <KeyValue label="Mount path" value={environment.mountPath} />
          <KeyValue label="Config exists" value={environment.configExists ? "Yes" : "No"} />
        </div>
      </div>

      <div className="panel diagnostics-panel">
        <div className="panel-header">
          <div>
            <h2>Paths</h2>
            <p>Shared Rust source of truth for migrated services.</p>
          </div>
        </div>
        <div className="kv-list">
          {pathRows.map(([label, value]) => (
            <KeyValue key={label} label={label} value={value} />
          ))}
        </div>
      </div>

      <div className="panel diagnostics-panel">
        <div className="panel-header">
          <div>
            <h2>Derived Env</h2>
            <p>Safe values derived from misty.json and process overrides.</p>
          </div>
        </div>
        <div className="kv-list">
          {Object.entries(environment.derivedEnv).map(([key, value]) => (
            <KeyValue key={key} label={key} value={value} />
          ))}
        </div>
      </div>
    </section>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
