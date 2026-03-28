import { RefreshCcw, Save } from "lucide-react";
import type { SettingsSnapshot } from "../../../api/types";
import { Panel, PanelHeader } from "../../../shared/components/Panel";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";

interface SettingsJsonPanelProps {
  settings: SettingsSnapshot | null;
  settingsText: string;
  working: boolean;
  onSettingsText: (value: string) => void;
  onRefresh: () => void;
  onSave: () => void;
}

export function SettingsJsonPanel(props: SettingsJsonPanelProps) {
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(props.working);
  return (
    <Panel className="settings-panel">
      <PanelHeader
        title="Settings"
        subtitle={props.settings?.path ?? "Loading ~/.misty/config/settings.json"}
        actions={
          <div className="panel-actions">
            <button
              onClick={() => {
                startRefreshSpin();
                props.onRefresh();
              }}
              disabled={props.working}
            >
              <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={16} />
              Reload
            </button>
            <button className="primary" onClick={props.onSave} disabled={props.working}>
              <Save size={16} />
              Save JSON
            </button>
          </div>
        }
      />
      <textarea
        className="json-editor"
        value={props.settingsText}
        spellCheck={false}
        onChange={(event) => props.onSettingsText(event.target.value)}
      />
    </Panel>
  );
}
