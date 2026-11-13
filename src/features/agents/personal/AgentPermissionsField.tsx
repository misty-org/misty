import { ClipboardList, Shield, ShieldCheck, ShieldOff, type LucideIcon } from "lucide-react";
import { Field, OptionSelect } from "@/shared/ui";
import { resolveEngineMode, useEngineModes, type EngineModeKind } from "../engines/engineModes";

const kindIcons: Record<EngineModeKind, LucideIcon> = {
  asks: Shield,
  edits: ShieldCheck,
  plans: ClipboardList,
  no_asking: ShieldOff,
};

/**
 * How new chats with this agent start: one of its engine's own modes, by the engine's names. An
 * older saved Ask or Auto shows as the engine's mode it maps to. Any chat can switch in its
 * composer. Not shown for an engine with only one mode.
 */
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
