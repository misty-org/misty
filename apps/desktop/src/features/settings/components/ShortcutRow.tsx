import type { ShortcutBinding } from "../../../api/types";
import { prettyLabel } from "../../../shared/format";

interface ShortcutRowProps {
  binding: ShortcutBinding;
  onChange: (commandId: string, shortcut: string) => void;
}

export function ShortcutRow(props: ShortcutRowProps) {
  const { binding, onChange } = props;
  return (
    <tr>
      <td>{binding.commandId}</td>
      <td>
        <input value={binding.shortcut} onChange={(event) => onChange(binding.commandId, event.target.value)} />
      </td>
      <td>{prettyLabel(binding.source)}</td>
    </tr>
  );
}
