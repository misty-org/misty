import { Button, cn, Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { Calendar as CalendarIcon, CalendarDays, Sunrise, Sun, X } from "lucide-react";
import { useMemo, useState } from "react";

interface TaskDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function TaskDatePicker({
  value,
  onChange,
  disabled = false,
  className,
}: TaskDatePickerProps) {
  const [open, setOpen] = useState(false);

  const formattedDate = useMemo(() => {
    if (!value) return null;
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return null;

      const now = new Date();
      const isToday =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();

      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow =
        date.getFullYear() === tomorrow.getFullYear() &&
        date.getMonth() === tomorrow.getMonth() &&
        date.getDate() === tomorrow.getDate();

      const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

      if (isToday) return `Today, ${timeStr}`;
      if (isTomorrow) return `Tomorrow, ${timeStr}`;

      const dateStr = date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      });
      return `${dateStr}, ${timeStr}`;
    } catch {
      return null;
    }
  }, [value]);

  const dateValue = useMemo(() => {
    if (!value) return "";
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return "";
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    } catch {
      return "";
    }
  }, [value]);

  const timeValue = useMemo(() => {
    if (!value) return "17:00";
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return "17:00";
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    } catch {
      return "17:00";
    }
  }, [value]);

  const setPreset = (daysFromNow: number, hours = 17, minutes = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(hours, minutes, 0, 0);
    onChange(toLocalInputString(d));
    setOpen(false);
  };

  const setNextWeekday = (targetDay: number, hours = 9, minutes = 0) => {
    const d = new Date();
    const currentDay = d.getDay();
    let diff = targetDay - currentDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    d.setHours(hours, minutes, 0, 0);
    onChange(toLocalInputString(d));
    setOpen(false);
  };

  const handleCustomDateChange = (newDateStr: string) => {
    if (!newDateStr) {
      onChange("");
      return;
    }
    const [hours, minutes] = timeValue.split(":").map(Number);
    const [y, m, d] = newDateStr.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d, hours || 17, minutes || 0);
    onChange(toLocalInputString(dateObj));
  };

  const handleCustomTimeChange = (newTimeStr: string) => {
    const currentD = value ? new Date(value) : new Date();
    const [hours, minutes] = (newTimeStr || "17:00").split(":").map(Number);
    currentD.setHours(hours, minutes, 0, 0);
    onChange(toLocalInputString(currentD));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          disabled={disabled}
          className={cn(
            "group flex h-8 w-full items-center justify-start gap-2 rounded-lg border-charcoal-border/70",
            "bg-charcoal-workspace/60 px-2.5 text-xs text-left shadow-none transition-all",
            "hover:border-charcoal-border hover:bg-charcoal-card",
            "disabled:pointer-events-none disabled:opacity-40",
            formattedDate ? "text-cream font-medium" : "text-cream-muted",
            className,
          )}
        >
          <CalendarIcon className="size-3.5 shrink-0 text-cream-muted group-hover:text-cream" />
          <span className="min-w-0 flex-1 truncate">{formattedDate ?? "Set due date"}</span>
          {formattedDate && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              className="grid size-4 shrink-0 place-items-center rounded hover:bg-charcoal-hover text-cream-muted hover:text-cream"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onChange("");
                }
              }}
            >
              <X className="size-3" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-3 bg-charcoal-card border-charcoal-border shadow-2xl"
      >
        <div className="grid gap-2.5">
          {/* Quick presets */}
          <div className="grid gap-1">
            <PresetButton
              icon={Sun}
              label="Today"
              sublabel="5:00 PM"
              onClick={() => setPreset(0, 17, 0)}
            />
            <PresetButton
              icon={Sunrise}
              label="Tomorrow"
              sublabel="5:00 PM"
              onClick={() => setPreset(1, 17, 0)}
            />
            <PresetButton
              icon={CalendarDays}
              label="Next Monday"
              sublabel="9:00 AM"
              onClick={() => setNextWeekday(1, 9, 0)}
            />
          </div>

          <div className="h-px bg-charcoal-border/60" />

          {/* Custom Date & Time Inputs */}
          <div className="grid gap-2">
            <div className="grid gap-1">
              <label className="text-[11px] font-medium text-cream-muted">Date</label>
              <Input
                type="date"
                value={dateValue}
                onChange={(e) => handleCustomDateChange(e.target.value)}
                className="h-7 text-xs bg-charcoal-workspace border-charcoal-border/80 text-cream"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-[11px] font-medium text-cream-muted">Time</label>
              <Input
                type="time"
                value={timeValue}
                onChange={(e) => handleCustomTimeChange(e.target.value)}
                className="h-7 text-xs bg-charcoal-workspace border-charcoal-border/80 text-cream"
              />
            </div>
          </div>

          {value ? (
            <>
              <div className="h-px bg-charcoal-border/60" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-xs text-cream-muted hover:text-notification-red"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear due date
              </Button>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetButton({
  icon: Icon,
  label,
  sublabel,
  onClick,
}: {
  icon: typeof Sun;
  label: string;
  sublabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center justify-between rounded-md px-2 text-xs text-cream-muted transition-colors",
        "hover:bg-charcoal-hover hover:text-cream text-left",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="font-medium text-cream">{label}</span>
      </div>
      <span className="text-[10px] text-cream-faint">{sublabel}</span>
    </Button>
  );
}

function toLocalInputString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
