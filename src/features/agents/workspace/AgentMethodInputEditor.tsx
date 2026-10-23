import { X } from "lucide-react";
import { Checkbox, IconButton, Input, OptionSelect } from "@/shared/ui";
import type { AgentMethodInput } from "@/api/ai/agent-methods";

/** One input a method asks for: its question, key, answer type and options. */
export function AgentMethodInputEditor({
  index,
  input,
  onChange,
  onRemove,
}: {
  index: number;
  input: AgentMethodInput;
  onChange(values: Partial<AgentMethodInput>): void;
  onRemove(): void;
}) {
  return (
    <div className="agent-method-input-editor">
      <label>
        Question
        <Input
          aria-label={`Input ${index + 1} question`}
          required
          maxLength={160}
          value={input.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>
      <label>
        Key
        <Input
          aria-label={`Input ${index + 1} key`}
          required
          pattern="[a-z][a-z0-9_]{0,39}"
          maxLength={40}
          value={input.key}
          onChange={(e) => onChange({ key: e.target.value })}
        />
      </label>
      <label>
        Answer type
        <OptionSelect
          aria-label={`Input ${index + 1} type`}
          value={input.type}
          options={["text", "number", "boolean", "choice"].map((value) => ({
            value,
            label: value === "boolean" ? "Yes or no" : value[0].toUpperCase() + value.slice(1),
          }))}
          onValueChange={(type) => onChange({ type: type as AgentMethodInput["type"] })}
        />
      </label>
      <label className="agent-method-check">
        <Checkbox
          checked={input.required}
          onCheckedChange={(checked) => onChange({ required: checked === true })}
        />
        Required
      </label>
      <IconButton type="button" label={`Remove input ${index + 1}`} onClick={onRemove}>
        <X size={15} />
      </IconButton>
      {input.type === "choice" && (
        <label className="agent-method-options">
          Options
          <Input
            required
            value={(input.options ?? []).join(", ")}
            onChange={(e) =>
              onChange({
                options: e.target.value.split(",").map((s) => s.trim()),
              })
            }
            placeholder="First option, second option"
          />
        </label>
      )}
    </div>
  );
}
