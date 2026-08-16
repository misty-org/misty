import { useRef, useState } from "react";
import { agentMethodsApi, type AgentMethod, type AgentMethodInputs } from "@/api/ai/agent-methods";
import {
  scheduledTasksApi,
  type ScheduledTask,
  type ScheduledTaskInput,
} from "@/api/scheduled/api";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  OptionSelect,
} from "@/shared/ui";
import { AgentMethodInputFields, methodError, methodTargets } from "./AgentMethodEditor";

/** Runs a workflow, opens a template as a draft, or schedules either. */
export function AgentMethodRunDialog({
  method,
  schedule,
  onClose,
  onUse,
  onConversation,
  onStartWork,
  onScheduled,
}: {
  method: AgentMethod;
  schedule: boolean;
  onClose(): void;
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
  onScheduled(task: ScheduledTask): void;
}) {
  const [inputs, setInputs] = useState<AgentMethodInputs>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cadence, setCadence] = useState<ScheduledTaskInput["cadence"]>("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState("1");
  const [monthDay, setMonthDay] = useState("1");
  const [runOn, setRunOn] = useState("");
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
    if (!schedule && method.kind === "workflow") onStartWork(() => void execute());
    else await execute();
  };
  const execute = async () => {
    setBusy(true);
    setError("");
    try {
      const { prompt } = await agentMethodsApi.instantiate(method.version_id, inputs);
      if (accountId !== useMistyStore.getState().accountId)
        throw new Error("The account changed. Close this dialog and try again.");
      if (schedule) {
        const { task } = await scheduledTasksApi.create({
          title: method.definition.title,
          prompt,
          enabled: true,
          agent_id: method.agent_id,
          method_version_id: method.version_id,
          method_inputs: inputs,
          cadence,
          local_time: time,
          weekday: Number(weekday),
          month_day: Number(monthDay),
          ...(cadence === "once" ? { run_on: runOn } : {}),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        onScheduled(task);
        onClose();
        return;
      }
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
          {schedule ? "Schedule" : method.kind === "template" ? "Use" : "Run"}{" "}
          {method.definition.title}
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
            {schedule && (
              <>
                <label>
                  Repeat
                  <OptionSelect
                    aria-label="Repeat"
                    value={cadence}
                    onValueChange={(value) => setCadence(value as ScheduledTaskInput["cadence"])}
                    options={[
                      { value: "once", label: "Once" },
                      { value: "daily", label: "Every day" },
                      { value: "weekdays", label: "Weekdays" },
                      { value: "weekly", label: "Every week" },
                      { value: "monthly", label: "Every month" },
                    ]}
                  />
                </label>
                <label>
                  Time
                  <Input
                    required
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
                {cadence === "weekly" && (
                  <label>
                    Day
                    <OptionSelect
                      aria-label="Day"
                      value={weekday}
                      onValueChange={setWeekday}
                      options={[
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((label, index) => ({ value: String(index), label }))}
                    />
                  </label>
                )}
                {cadence === "monthly" && (
                  <label>
                    Day of month
                    <Input
                      required
                      type="number"
                      min={1}
                      max={31}
                      value={monthDay}
                      onChange={(e) => setMonthDay(e.target.value)}
                    />
                  </label>
                )}
                {cadence === "once" && (
                  <label>
                    Date
                    <Input
                      required
                      type="date"
                      value={runOn}
                      onChange={(e) => setRunOn(e.target.value)}
                    />
                  </label>
                )}
                <p className="agent-method-hint">
                  Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Editing this
                  workflow later will not change this schedule’s saved version or inputs.
                </p>
                {method.definition.target !== "cloud" && (
                  <p className="agent-method-hint">
                    This workflow needs an interactive Misty device. Unattended browser control is
                    not available; scheduled occurrences will report unavailable device access. Run
                    it manually for now.
                  </p>
                )}
              </>
            )}
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
              {busy
                ? "Preparing…"
                : schedule
                  ? "Save schedule"
                  : method.kind === "template"
                    ? "Open draft"
                    : "Run workflow"}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
