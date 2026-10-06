import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { ScheduleFrequency, ScheduleRule } from "@/api/ai/agent-methods";
import { Button, IconButton, Input, OptionSelect, ToggleGroup, ToggleGroupItem } from "@/shared/ui";
import { monthNames, nthNames, weekdayLongNames, weekdayNames } from "./scheduleSummary";

const frequencies: { value: ScheduleFrequency; label: string; unit: string }[] = [
  { value: "once", label: "On specific dates", unit: "" },
  { value: "hourly", label: "Hourly", unit: "hours" },
  { value: "daily", label: "Daily", unit: "days" },
  { value: "weekly", label: "Weekly", unit: "weeks" },
  { value: "monthly", label: "Monthly", unit: "months" },
  { value: "yearly", label: "Yearly", unit: "years" },
];

/** A fresh rule of a frequency, keeping the times and dates already chosen. */
export function ruleFor(frequency: ScheduleFrequency, from?: ScheduleRule): ScheduleRule {
  const times = from?.times?.length ? from.times : ["09:00"];
  const today = new Date().toLocaleDateString("en-CA");
  switch (frequency) {
    case "once":
      return { frequency, dates: [today], times };
    case "hourly":
      return { frequency, interval: 1, minute: 0 };
    case "weekly":
      return { frequency, interval: 1, weekdays: [new Date().getDay()], times };
    case "monthly":
      return { frequency, interval: 1, month_days: [new Date().getDate()], times };
    case "yearly":
      return {
        frequency,
        interval: 1,
        months: [new Date().getMonth() + 1],
        month_days: [new Date().getDate()],
        times,
      };
    default:
      return { frequency, interval: 1, times };
  }
}

function parseDays(text: string) {
  return text
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => (/^last$/i.test(part) ? -1 : Number(part)))
    .filter((day) => day === -1 || (Number.isInteger(day) && day >= 1 && day <= 31));
}

function Days({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange(days: number[]): void;
}) {
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      aria-label={label}
      value={value.map(String)}
      onValueChange={(next) => onChange(next.map(Number).sort())}
    >
      {weekdayNames.map((name, day) => (
        <ToggleGroupItem key={name} value={String(day)} aria-label={weekdayLongNames[day]}>
          {name.slice(0, 2)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function List({
  label,
  type,
  values,
  fallback,
  onChange,
}: {
  label: string;
  type: "time" | "date";
  values: string[];
  fallback: string;
  onChange(values: string[]): void;
}) {
  return (
    <div className="workflow-schedule-list" role="group" aria-label={label}>
      {values.map((value, index) => (
        <span key={index} className="workflow-schedule-chip">
          <Input
            type={type}
            required
            aria-label={`${label} ${index + 1}`}
            value={value}
            onChange={(e) => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
          />
          {values.length > 1 && (
            <IconButton
              label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              <X size={13} />
            </IconButton>
          )}
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange([...values, fallback])}
      >
        <Plus size={13} />
        Add
      </Button>
    </div>
  );
}

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
          <div className="workflow-schedule-list" role="group" aria-label="Weekdays of the month">
            {(rule.nth_weekdays ?? []).map((nth, i) => (
              <span key={i} className="workflow-schedule-chip">
                the
                <OptionSelect
                  aria-label="Which week"
                  value={String(nth.nth)}
                  options={[1, 2, 3, 4, 5, -1].map((n) => ({
                    value: String(n),
                    label: nthNames[n],
                  }))}
                  onValueChange={(value) =>
                    set({
                      nth_weekdays: rule.nth_weekdays!.map((x, j) =>
                        j === i ? { ...x, nth: Number(value) } : x,
                      ),
                    })
                  }
                />
                <OptionSelect
                  aria-label="Weekday"
                  value={String(nth.weekday)}
                  options={weekdayLongNames.map((label, d) => ({ value: String(d), label }))}
                  onValueChange={(value) =>
                    set({
                      nth_weekdays: rule.nth_weekdays!.map((x, j) =>
                        j === i ? { ...x, weekday: Number(value) } : x,
                      ),
                    })
                  }
                />
                <IconButton
                  label={`Remove weekday rule ${i + 1}`}
                  onClick={() =>
                    set({ nth_weekdays: rule.nth_weekdays!.filter((_, j) => j !== i) })
                  }
                >
                  <X size={13} />
                </IconButton>
              </span>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                set({ nth_weekdays: [...(rule.nth_weekdays ?? []), { nth: 1, weekday: 1 }] })
              }
            >
              <Plus size={13} />
              Add a weekday, such as the first Monday
            </Button>
          </div>
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
