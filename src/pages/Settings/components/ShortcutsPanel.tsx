import { Save } from "lucide-react";
import type { ShortcutsSnapshot } from "../../../api/types";
import { Panel, PanelHeader } from "../../../shared/components/Panel";
import { ShortcutRow } from "./ShortcutRow";

interface ShortcutsPanelProps {
  shortcuts: ShortcutsSnapshot | null;
  working: boolean;
  onShortcutChange: (commandId: string, shortcut: string) => void;
  onSave: () => void;
}

export function ShortcutsPanel(props: ShortcutsPanelProps) {
  return (
    <Panel className="settings-panel">
      <PanelHeader
        title="Keyboard Shortcuts"
        subtitle={props.shortcuts?.path ?? "Loading ~/.misty/config/commands.msy"}
        actions={
          <button className="primary" onClick={props.onSave} disabled={props.working || !props.shortcuts}>
            <Save size={16} />
            Save Shortcuts
          </button>
        }
      />
      <div className="shortcuts-table-wrap">
        <table className="shortcuts-table">
          <thead>
            <tr>
              <th>Command</th>
              <th>Shortcut</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {props.shortcuts?.bindings.map((binding) => (
              <ShortcutRow key={binding.commandId} binding={binding} onChange={props.onShortcutChange} />
            ))}
          </tbody>
        </table>
        {props.shortcuts && props.shortcuts.bindings.length === 0 ? (
          <div className="m-[18px] text-[var(--misty-text-muted)]">No shortcuts configured.</div>
        ) : null}
      </div>
    </Panel>
  );
}
