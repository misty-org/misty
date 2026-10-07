import { Plus } from "lucide-react";
import { useState } from "react";
import {
  agentMethodsApi,
  type AgentMethod,
  type AgentMethodInputs,
  type ScheduleRule,
  type WorkflowSchedule,
} from "@/api/ai/agent-methods";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  OptionSelect,
  Switch,
} from "@/shared/ui";
import { AgentMethodInputFields, methodError } from "../workspace/AgentMethodEditor";
import { ruleFor, ScheduleRuleEditor } from "./ScheduleRuleEditor";
import { describeSchedule } from "./scheduleSummary";

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zones = (() => {
  const all =
    (Intl as { supportedValuesOf?(key: string): string[] }).supportedValuesOf?.("timeZone") ?? [];
  return all.includes(localZone) ? all : [localZone, ...all];
})();

/**
 * A workflow's schedule: any number of rules in one timezone, skipped dates, the inputs
 * for scheduled runs, and an on/off switch. Runs always use the workflow's latest version.
 */
export function WorkflowScheduleDialog({
  method,
  onClose,
  onSaved,
}: {
  method: AgentMethod;
  onClose(): void;
  onSaved(schedule: WorkflowSchedule | undefined): void;
}) {
  const existing = method.schedule;
  const [rules, setRules] = useState<ScheduleRule[]>(existing?.rules ?? [ruleFor("weekly")]);
  const [timezone, setTimezone] = useState(existing?.timezone ?? localZone);
  const [skipDates, setSkipDates] = useState<string[]>(existing?.skip_dates ?? []);
  const [inputs, setInputs] = useState<AgentMethodInputs>(existing?.inputs ?? {});
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (cause) {
      setError(methodError(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const missing = method.definition.inputs.find(
      (f) => f.required && (inputs[f.key] === undefined || inputs[f.key] === ""),
    );
    if (missing) {
      setError(`Answer “${missing.label}” so scheduled runs have it.`);
      return;
    }
    void run(async () => {
      const { schedule } = await agentMethodsApi.saveSchedule(method.id, {
        timezone,
        rules,
        skip_dates: skipDates.filter(Boolean),
        inputs,
        enabled,
      });
      onSaved(schedule);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="agent-studio-dialog agent-method-dialog workflow-schedule-dialog">
        <DialogTitle>Schedule {method.definition.title}</DialogTitle>
        <DialogDescription>
          {describeSchedule({ timezone, rules, skip_dates: skipDates })}
        </DialogDescription>
        <form onSubmit={save}>
          <fieldset disabled={busy} className="agent-method-fields">
            <label className="agent-method-check">
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Schedule on" />
              {enabled ? "On" : "Paused"}
            </label>
            {rules.map((rule, index) => (
              <ScheduleRuleEditor
                key={index}
                rule={rule}
                index={index}
                removable={rules.length > 1}
                onChange={(next) => setRules(rules.map((r, i) => (i === index ? next : r)))}
                onRemove={() => setRules(rules.filter((_, i) => i !== index))}
              />
            ))}
            {rules.length < 20 && (
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => setRules([...rules, ruleFor("daily")])}
              >
                <Plus size={14} />
                Add another rule
              </Button>
            )}
            <label>
              Timezone
              <OptionSelect
                aria-label="Timezone"
                value={timezone}
                options={zones.map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }))}
                onValueChange={setTimezone}
              />
            </label>
            <div className="grid gap-2">
              <span>Skip these dates</span>
              <div className="workflow-schedule-list">
                {skipDates.map((day, i) => (
                  <Input
                    key={i}
                    type="date"
                    aria-label={`Skipped date ${i + 1}`}
                    value={day}
                    onChange={(e) =>
                      setSkipDates(skipDates.map((d, j) => (j === i ? e.target.value : d)))
                    }
                  />
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSkipDates([...skipDates, new Date().toLocaleDateString("en-CA")])
                  }
                >
                  <Plus size={13} />
                  Skip a date
                </Button>
              </div>
            </div>
            {method.definition.inputs.length > 0 && (
              <AgentMethodInputFields
                fields={method.definition.inputs}
                values={inputs}
                onChange={setInputs}
              />
            )}
            {method.definition.target !== "cloud" && (
              <p className="agent-method-hint">
                This workflow needs an interactive Misty device. Unattended browser control is not
                available, so scheduled runs will report unavailable device access.
              </p>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="agent-method-error">
              {error}
            </p>
          )}
          <footer>
            {existing && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await agentMethodsApi.removeSchedule(method.id);
                    onSaved(undefined);
                  })
                }
              >
                Remove schedule
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || rules.length === 0}>
              Save schedule
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
