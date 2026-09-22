import { Field, SegmentedControl } from "@/shared/ui";

type PermissionMode = "ask" | "auto";

const options = [
  { value: "ask" as const, label: "Ask" },
  { value: "auto" as const, label: "Auto" },
];

/**
 * How new chats with this agent start. Ask pauses before every change; Auto
 * continues where you remembered an approval and asks for the rest. Any chat can
 * switch in its options.
 */
export function AgentPermissionsField(props: {
  value: PermissionMode;
  onChange: (value: PermissionMode) => void;
}) {
  return (
    <Field label="Default permissions">
      <div className="grid gap-1.5">
        <SegmentedControl
          label="Default permissions"
          value={props.value}
          options={options}
          onChange={props.onChange}
          size="sm"
        />
        <span className="text-xs text-cream-muted">
          {props.value === "ask"
            ? "Pauses before every change for your OK."
            : "Continues where you remembered an approval; asks for the rest."}
        </span>
      </div>
    </Field>
  );
}
