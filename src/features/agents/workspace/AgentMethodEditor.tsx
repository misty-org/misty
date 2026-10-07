import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  OptionSelect,
  Textarea,
} from "@/shared/ui";
import type {
  AgentMethod,
  AgentMethodDefinition,
  AgentMethodInput,
  AgentMethodInputs,
  AgentMethodKind,
  SaveAgentMethod,
} from "@/api/ai/agent-methods";

export const methodTargets = [
  { value: "cloud", label: "Connected apps and Misty context" },
  { value: "separate_window", label: "A separate Misty window" },
  { value: "current_window", label: "This Misty window" },
];
export const blankDefinition = (): AgentMethodDefinition => ({
  title: "",
  description: "",
  instructions: "",
  inputs: [],
  target: "cloud",
  required_tools: [],
});
export function methodError(error: unknown) {
  if (error && typeof error === "object" && "status" in error && error.status === 409)
    return (
      "This method changed or a method limit was reached. Your draft is kept here. " +
      "Reload the latest version; if eight skills are enabled, disable one before adding another."
    );
  return error instanceof Error
    ? error.message
    : "The request failed. Your changes have been kept; try again.";
}

export function AgentMethodEditor({
  agentId,
  kind,
  method,
  initial,
  sources,
  onClose,
  onSave,
}: {
  agentId: string;
  kind: AgentMethodKind;
  method?: AgentMethod;
  initial?: AgentMethodDefinition;
  sources: { value: string; label: string }[];
  onClose(): void;
  onSave(input: SaveAgentMethod): Promise<void>;
}) {
  const [definition, setDefinition] = useState(method?.definition ?? initial ?? blankDefinition());
  const [tools, setTools] = useState(
    (method?.definition ?? initial)?.required_tools.join(", ") ?? "",
  );
  const [enabled, setEnabled] = useState(method?.enabled ?? true);
  const [source, setSource] = useState(method?.source_invocation_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (values: Partial<AgentMethodDefinition>) =>
    setDefinition((d) => ({ ...d, ...values }));
  const field = (index: number, values: Partial<AgentMethodInput>) =>
    patch({ inputs: definition.inputs.map((f, i) => (i === index ? { ...f, ...values } : f)) });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (new Set(definition.inputs.map((f) => f.key)).size !== definition.inputs.length) {
      setError("Each input needs a different key.");
      return;
    }
    if (definition.inputs.some((f) => f.type === "choice" && (f.options?.length ?? 0) < 2)) {
      setError("Choice inputs need at least two options, separated by commas.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        agent_id: agentId,
        kind,
        enabled,
        definition: {
          ...definition,
          required_tools: tools
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
        ...(method ? { id: method.id, expected_version: method.version } : {}),
        ...(source ? { source_invocation_id: source } : {}),
      });
      onClose();
    } catch (cause) {
      setError(methodError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="agent-studio-dialog agent-method-dialog">
        <DialogTitle>
          {method ? "Edit" : "New"} {kind}
        </DialogTitle>
        <DialogDescription>
          {kind === "skill"
            ? "Reusable guidance for this agent. Up to eight enabled skills apply to new tasks."
            : "Save a reusable method with inputs and a work location."}{" "}
          {method &&
            `Editing version ${method.version}. Existing runs and schedules keep their saved version.`}
        </DialogDescription>
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={busy} className="agent-method-fields">
            <label>
              Name
              <Input
                required
                maxLength={120}
                value={definition.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            <label>
              Description
              <Input
                maxLength={1000}
                value={definition.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <label>
              Instructions
              <Textarea
                required
                maxLength={6000}
                rows={7}
                value={definition.instructions}
                onChange={(e) => patch({ instructions: e.target.value })}
                placeholder="Describe the steps, expected result, and when to ask for review…"
              />
            </label>
            <p className="agent-method-hint">
              Save the method, not private results or credentials. Instructions do not grant
              additional access.
            </p>
            {kind !== "skill" && (
              <label>
                Work location
                <OptionSelect
                  aria-label="Work location"
                  value={definition.target}
                  options={methodTargets}
                  onValueChange={(target) =>
                    patch({ target: target as AgentMethodDefinition["target"] })
                  }
                />
              </label>
            )}
            <label>
              Required tools
              <Input
                value={tools}
                maxLength={2000}
                onChange={(e) => setTools(e.target.value)}
                placeholder="Optional tool names, separated by commas"
              />
            </label>
            <label>
              Based on a successful task
              <OptionSelect
                aria-label="Based on a successful task"
                value={source}
                options={[
                  { value: "", label: "Start from my instructions" },
                  ...sources,
                  ...(source && !sources.some((s) => s.value === source)
                    ? [{ value: source, label: "Original completed task" }]
                    : []),
                ]}
                onValueChange={setSource}
              />
            </label>
            {kind !== "skill" && (
              <>
                <div className="agent-method-section-heading">
                  <h3>Inputs</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={definition.inputs.length >= 12}
                    onClick={() =>
                      patch({
                        inputs: [
                          ...definition.inputs,
                          {
                            key: `input_${definition.inputs.length + 1}`,
                            label: "",
                            type: "text",
                            required: true,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    Add input
                  </Button>
                </div>
                {definition.inputs.map((input, index) => (
                  <div className="agent-method-input-editor" key={index}>
                    <label>
                      Question
                      <Input
                        aria-label={`Input ${index + 1} question`}
                        required
                        maxLength={160}
                        value={input.label}
                        onChange={(e) => field(index, { label: e.target.value })}
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
                        onChange={(e) => field(index, { key: e.target.value })}
                      />
                    </label>
                    <label>
                      Answer type
                      <OptionSelect
                        aria-label={`Input ${index + 1} type`}
                        value={input.type}
                        options={["text", "number", "boolean", "choice"].map((value) => ({
                          value,
                          label:
                            value === "boolean"
                              ? "Yes or no"
                              : value[0].toUpperCase() + value.slice(1),
                        }))}
                        onValueChange={(type) =>
                          field(index, { type: type as AgentMethodInput["type"] })
                        }
                      />
                    </label>
                    <label className="agent-method-check">
                      <Checkbox
                        checked={input.required}
                        onCheckedChange={(checked) => field(index, { required: checked === true })}
                      />
                      Required
                    </label>
                    <IconButton
                      type="button"
                      label={`Remove input ${index + 1}`}
                      onClick={() =>
                        patch({ inputs: definition.inputs.filter((_, i) => i !== index) })
                      }
                    >
                      <X size={15} />
                    </IconButton>
                    {input.type === "choice" && (
                      <label className="agent-method-options">
                        Options
                        <Input
                          required
                          value={(input.options ?? []).join(", ")}
                          onChange={(e) =>
                            field(index, {
                              options: e.target.value.split(",").map((s) => s.trim()),
                            })
                          }
                          placeholder="First option, second option"
                        />
                      </label>
                    )}
                  </div>
                ))}
              </>
            )}
            <label className="agent-method-check">
              <Checkbox
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked === true)}
              />
              {kind === "skill" ? "Use this skill in new tasks" : "Enabled"}
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="agent-method-error">
              {error}
            </p>
          )}
          <footer>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : `Save ${kind}`}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Keep unanswered booleans distinct from false; required questions must be answered explicitly. */
export function AgentMethodInputFields({
  fields,
  values,
  onChange,
}: {
  fields: AgentMethodInput[];
  values: AgentMethodInputs;
  onChange(values: AgentMethodInputs): void;
}) {
  const update = (key: string, value: string | number | boolean | undefined) => {
    const next = { ...values };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <>
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.required ? " *" : ""}
          {field.type === "boolean" || field.type === "choice" ? (
            <OptionSelect
              aria-label={field.label}
              value={values[field.key] === undefined ? "" : String(values[field.key])}
              options={[
                { value: "", label: "Choose an answer" },
                ...(field.type === "boolean"
                  ? [
                      { value: "true", label: "Yes" },
                      { value: "false", label: "No" },
                    ]
                  : (field.options ?? []).map((value) => ({ value, label: value }))),
              ]}
              onValueChange={(value) =>
                update(
                  field.key,
                  value === "" ? undefined : field.type === "boolean" ? value === "true" : value,
                )
              }
            />
          ) : (
            <Input
              aria-label={field.label}
              required={field.required}
              type={field.type === "number" ? "number" : "text"}
              step={field.type === "number" ? "any" : undefined}
              maxLength={2000}
              value={values[field.key] === undefined ? "" : String(values[field.key])}
              onChange={(e) =>
                update(
                  field.key,
                  e.target.value === ""
                    ? undefined
                    : field.type === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                )
              }
            />
          )}
        </label>
      ))}
    </>
  );
}
