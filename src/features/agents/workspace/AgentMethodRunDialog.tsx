import { useRef, useState } from "react";
import { agentMethodsApi, type AgentMethod, type AgentMethodInputs } from "@/api/ai/agent-methods";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { AgentMethodInputFields, methodError, methodTargets } from "./AgentMethodEditor";

/** Runs a workflow now, or opens a template as a draft. */
export function AgentMethodRunDialog({
  method,
  onClose,
  onUse,
  onConversation,
  onStartWork,
}: {
  method: AgentMethod;
  onClose(): void;
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
}) {
  const [inputs, setInputs] = useState<AgentMethodInputs>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef({ key: `method-${crypto.randomUUID()}`, conversationId: "" });
  const accountId = useRef(useMistyStore.getState().accountId).current;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const missing = method.definition.inputs.find(
      (f) => f.required && (inputs[f.key] === undefined || inputs[f.key] === ""),
    );
    if (missing) {
      setError(`Answer “${missing.label}” before continuing.`);
      return;
    }
    if (method.kind === "workflow") onStartWork(() => void execute());
    else await execute();
  };
  const execute = async () => {
    setBusy(true);
    setError("");
    try {
      const { prompt } = await agentMethodsApi.instantiate(method.version_id, inputs);
      if (accountId !== useMistyStore.getState().accountId)
        throw new Error("The account changed. Close this dialog and try again.");
      if (method.kind === "template") {
        onUse(prompt);
        onClose();
        return;
      }
      if (useMistyStore.getState().working)
        throw new Error("Wait for the current task to finish before starting a workflow.");
      if (!attempt.current.conversationId)
        attempt.current.conversationId = await useMistyStore
          .getState()
          .newConversation(undefined, method.agent_id);
      if (accountId !== useMistyStore.getState().accountId)
        throw new Error("The account changed. Close this dialog and try again.");
      const conversationId = attempt.current.conversationId;
      useMistyStore.setState({ selectedAgentId: method.agent_id });
      await useMistyStore.getState().submitAnswer(
        prompt,
        [],
        undefined,
        "workspace",
        [],
        { conversationId, context: [] },
        {
          executionMode:
            method.definition.target === "cloud"
              ? "user"
              : method.definition.target === "separate_window"
                ? "team"
                : "agent",
          methodVersionId: method.version_id,
          methodInputs: inputs,
          idempotencyKey: attempt.current.key,
        },
      );
      if (useMistyStore.getState().error) throw new Error(useMistyStore.getState().error!);
      onConversation(conversationId);
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
          {method.kind === "template" ? "Use" : "Run"} {method.definition.title}
        </DialogTitle>
        <DialogDescription>
          Version {method.version} ·{" "}
          {methodTargets.find((t) => t.value === method.definition.target)?.label}.{" "}
          {method.kind === "template"
            ? "This opens an unsent draft."
            : "The task uses your agent’s existing access and approvals."}
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy} className="agent-method-fields">
            <AgentMethodInputFields
              fields={method.definition.inputs}
              values={inputs}
              onChange={setInputs}
            />
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
              {method.kind === "template" ? "Open draft" : "Run workflow"}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
