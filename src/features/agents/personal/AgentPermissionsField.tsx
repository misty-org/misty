import { ClipboardList, Shield, ShieldCheck, ShieldOff, type LucideIcon } from "lucide-react";
import { Field, OptionSelect } from "@misty/ui";
import { resolveEngineMode, useEngineModes, type EngineModeKind } from "../engines/engine_modes";

const kindIcons: Record<EngineModeKind, LucideIcon> = {
  asks: Shield,
  edits: ShieldCheck,
  plans: ClipboardList,
  no_asking: ShieldOff,
};

export function AgentPermissionsField(props: {
  engine?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const modes = useEngineModes(props.engine);
  const current = resolveEngineMode(modes, props.value);
  if (modes.length < 2 || !current) return null;
  return (
    <Field label="Default mode">
      <OptionSelect
        aria-label="Default mode"
        value={current.id}
        options={modes.map((mode) => ({
          value: mode.id,
          label: mode.label,
          icon: kindIcons[mode.kind],
        }))}
        onValueChange={props.onChange}
      />
    </Field>
  );
}
