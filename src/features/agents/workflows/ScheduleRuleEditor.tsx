import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { ScheduleFrequency, ScheduleRule } from "@/api/ai/agent-methods";
import { IconButton, Input, OptionSelect, ToggleGroup, ToggleGroupItem } from "@/shared/ui";
import { scheduleFrequencies as frequencies, parseDays, ruleFor } from "./scheduleRules";
import { Days, List, NthWeekdays } from "./ScheduleRuleInputs";
import { monthNames } from "./scheduleSummary";

/** Edits one repeating pattern of a schedule. */
export function ScheduleRuleEditor({
  rule,
  index,
  removable,
  onChange,
  onRemove,
}: {
  rule: ScheduleRule;
  index: number;
  removable: boolean;
  onChange(rule: ScheduleRule): void;
  onRemove(): void;
}) {
  const [daysText, setDaysText] = useState(
    (rule.month_days ?? []).map((d) => (d === -1 ? "last" : String(d))).join(", "),
  );
  const set = (patch: Partial<ScheduleRule>) => onChange({ ...rule, ...patch });
  const unit = frequencies.find((f) => f.value === rule.frequency)?.unit;
  const calendar = rule.frequency === "monthly" || rule.frequency === "yearly";
  return (
    <fieldset className="workflow-schedule-rule" aria-label={`Rule ${index + 1}`}>
      <div className="workflow-schedule-row">
        <OptionSelect
          aria-label="Repeat"
          value={rule.frequency}
          options={frequencies.map(({ value, label }) => ({ value, label }))}
          onValueChange={(value) => onChange(ruleFor(value as ScheduleFrequency, rule))}
        />
        {unit && (
          <label className="workflow-schedule-inline">
            every
            <Input
              type="number"
              min={1}
              max={rule.frequency === "hourly" ? 23 : 365}
              aria-label={`Interval in ${unit}`}
              value={rule.interval ?? 1}
              onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })}
            />
            {unit}
          </label>
        )}
        {removable && (
          <IconButton label={`Remove rule ${index + 1}`} className="ml-auto" onClick={onRemove}>
            <Trash2 size={14} />
          </IconButton>
        )}
      </div>
      {rule.frequency === "weekly" && (
        <label>
          On
          <Days
            label="Days of the week"
            value={rule.weekdays ?? []}
            onChange={(weekdays) => set({ weekdays })}
          />
        </label>
      )}
      {(rule.frequency === "daily" || rule.frequency === "hourly") && (
        <label>
          Only on (optional)
          <Days
            label="Only on these days"
            value={rule.weekdays ?? []}
            onChange={(weekdays) => set({ weekdays })}
          />
        </label>
      )}
      {rule.frequency === "hourly" && (
        <div className="workflow-schedule-row">
          <label className="workflow-schedule-inline">
            at minute
            <Input
              type="number"
              min={0}
              max={59}
              aria-label="Minute past the hour"
              value={rule.minute ?? 0}
              onChange={(e) =>
                set({ minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })
              }
            />
          </label>
          <label className="workflow-schedule-inline">
            between
            <Input
              type="time"
              aria-label="From"
              value={rule.from ?? ""}
              onChange={(e) => set({ from: e.target.value || undefined })}
            />
            and
            <Input
              type="time"
              aria-label="Until"
              value={rule.until ?? ""}
              onChange={(e) => set({ until: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
      {rule.frequency === "yearly" && (
        <label>
          In
          <ToggleGroup
            type="multiple"
            variant="outline"
            aria-label="Months"
            className="flex-wrap"
            value={(rule.months ?? []).map(String)}
            onValueChange={(next) => set({ months: next.map(Number).sort((a, b) => a - b) })}
          >
            {monthNames.map((name, i) => (
              <ToggleGroupItem key={name} value={String(i + 1)}>
                {name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </label>
      )}
      {calendar && (
        <>
          <label>
            On days of the month
            <Input
              aria-label="Days of the month"
              placeholder="1, 15, last"
              value={daysText}
              onChange={(e) => {
                setDaysText(e.target.value);
                set({ month_days: parseDays(e.target.value) });
              }}
            />
          </label>
          <NthWeekdays
            value={rule.nth_weekdays ?? []}
            onChange={(nth_weekdays) => set({ nth_weekdays })}
          />
        </>
      )}
      {rule.frequency === "once" && (
        <label>
          On
          <List
            label="Date"
            type="date"
            values={rule.dates ?? []}
            fallback={new Date().toLocaleDateString("en-CA")}
            onChange={(dates) => set({ dates })}
          />
        </label>
      )}
      {rule.frequency !== "hourly" && (
        <label>
          At
          <List
            label="Time"
            type="time"
            values={rule.times ?? []}
            fallback="12:00"
            onChange={(times) => set({ times })}
          />
        </label>
      )}
      {rule.frequency !== "once" && (
        <div className="workflow-schedule-row">
          <label className="workflow-schedule-inline">
            Starts
            <Input
              type="date"
              aria-label="Starts"
              value={rule.start_date ?? ""}
              onChange={(e) => set({ start_date: e.target.value || undefined })}
            />
          </label>
          <label className="workflow-schedule-inline">
            Ends (optional)
            <Input
              type="date"
              aria-label="Ends"
              value={rule.end_date ?? ""}
              onChange={(e) => set({ end_date: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}
