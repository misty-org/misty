import { Button, cn } from "@/shared/ui";
import { useEffect, useState } from "react";
import { useDevicePreferences } from "../devicePreferences/store";

/**
 * Appears at the bottom right while settings have unsaved changes. Trying to leave with
 * changes pending makes it nudge and say so, rather than closing.
 */
export function SettingsSaveBar() {
  const dirty = useDevicePreferences((s) => s.dirty);
  const attention = useDevicePreferences((s) => s.attention);
  const [saving, setSaving] = useState(false);
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    if (!attention) return;
    setNudge(attention);
    const timer = setTimeout(() => setNudge(0), 2200);
    return () => clearTimeout(timer);
  }, [attention]);
  if (!dirty) return null;
  const warned = nudge > 0;
  return (
    <div
      // Remounting on each attempt replays the shake.
      key={warned ? `nudge-${nudge}` : "bar"}
      role="alertdialog"
      aria-label="Unsaved changes"
      aria-live="assertive"
      className={cn(
        "absolute bottom-4 right-6 z-20 flex max-w-[calc(100%-48px)] items-center gap-4",
        "rounded-xl border border-charcoal-border bg-charcoal-card py-2.5 pl-4 pr-2.5 shadow-2xl",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
        warned && "misty-shake",
      )}
    >
      <p className="m-0 text-[15px] leading-6 text-cream">
        {warned ? "Save or cancel your changes before leaving." : "You have unsaved changes."}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() =>
            void useDevicePreferences
              .getState()
              .discardStaged()
              .catch(() => {})
          }
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void useDevicePreferences
              .getState()
              .saveStaged()
              .catch(() => {})
              .finally(() => setSaving(false));
          }}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
