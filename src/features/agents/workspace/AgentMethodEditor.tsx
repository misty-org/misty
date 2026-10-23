import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  OptionSelect,
  Textarea,
} from "@/shared/ui";
import type {
  AgentMethod,
  AgentMethodDefinition,
  AgentMethodInput,
  AgentMethodKind,
  SaveAgentMethod,
} from "@/api/ai/agent-methods";
import { blankDefinition, methodError, methodTarget, methodTargets } from "./agentMethodDefinition";
import { AgentMethodInputEditor } from "./AgentMethodInputEditor";

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
  // Saved templates are workflows to the person; the kind itself is saved as it was.
  const noun = kind === "template" ? "workflow" : kind;
  const [definition, setDefinition] = useState(() => {
    const start = method?.definition ?? initial ?? blankDefinition();
    return { ...start, target: methodTarget(start) };
  });
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
          {method ? "Edit" : "New"} {noun}
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
                  <AgentMethodInputEditor
                    key={index}
                    index={index}
                    input={input}
                    onChange={(values) => field(index, values)}
                    onRemove={() =>
                      patch({ inputs: definition.inputs.filter((_, i) => i !== index) })
                    }
                  />
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
              {busy ? "Saving…" : `Save ${noun}`}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
