import { Button, cn, Surface, Text } from "@misty/ui";
import { useEffect, useState } from "react";
import { useDevicePreferences } from "../device-preferences/store";

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
    <Surface
      key={warned ? `nudge-${nudge}` : "bar"}
      role="alertdialog"
      aria-label="Unsaved changes"
      aria-live="assertive"
      tone="card"
      edge="hairline"
      radius="xl"
      className={cn(
        "absolute bottom-4 right-6 z-20 flex max-w-[calc(100%-var(--spacing)*12)] items-center gap-4",
        "py-2.5 pl-4 pr-2.5",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
        warned && "misty-shake",
      )}
    >
      <Text as="p" size="control" tone="default" className="m-0">
        {warned ? "Save or cancel your changes before leaving." : "You have unsaved changes."}
      </Text>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="quiet"
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
    </Surface>
  );
}
