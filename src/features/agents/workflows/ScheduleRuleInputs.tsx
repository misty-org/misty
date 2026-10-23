import { Plus, X } from "lucide-react";
import type { ScheduleRule } from "@/api/ai/agent-methods";
import { Button, IconButton, Input, OptionSelect, ToggleGroup, ToggleGroupItem } from "@/shared/ui";
import { nthNames, weekdayLongNames, weekdayNames } from "./scheduleSummary";

/** Weekdays as a row of toggles. */
export function Days({
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

/** Dates or times, each removable, with Add. */
export function List({
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

/** Weekdays of the month, such as "the first Monday". */
export function NthWeekdays({
  value,
  onChange,
}: {
  value: NonNullable<ScheduleRule["nth_weekdays"]>;
  onChange(value: NonNullable<ScheduleRule["nth_weekdays"]>): void;
}) {
  const patch = (index: number, change: Partial<(typeof value)[number]>) =>
    onChange(value.map((x, j) => (j === index ? { ...x, ...change } : x)));
  return (
    <div className="workflow-schedule-list" role="group" aria-label="Weekdays of the month">
      {value.map((nth, i) => (
        <span key={i} className="workflow-schedule-chip">
          the
          <OptionSelect
            aria-label="Which week"
            value={String(nth.nth)}
            options={[1, 2, 3, 4, 5, -1].map((n) => ({
              value: String(n),
              label: nthNames[n],
            }))}
            onValueChange={(next) => patch(i, { nth: Number(next) })}
          />
          <OptionSelect
            aria-label="Weekday"
            value={String(nth.weekday)}
            options={weekdayLongNames.map((label, d) => ({ value: String(d), label }))}
            onValueChange={(next) => patch(i, { weekday: Number(next) })}
          />
          <IconButton
            label={`Remove weekday rule ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={13} />
          </IconButton>
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange([...value, { nth: 1, weekday: 1 }])}
      >
        <Plus size={13} />
        Add a weekday, such as the first Monday
      </Button>
    </div>
  );
}
