import { useEffect, useState } from "react";
import { invoke } from "@/native/invoke";
import { DropdownMenuCheckboxItem, DropdownMenuSeparator } from "@/shared/ui";

/** This device's engine settings, as native code keeps them in misty.db. */
interface EngineSettings {
  codexServiceTier?: string | null;
  [key: string]: unknown;
}

/** Codex Fast (its priority service tier), for this device. Shown only for Codex. */
export function CodexFastItem({ engine }: { engine?: string }) {
  const [settings, setSettings] = useState<EngineSettings>();
  useEffect(() => {
    if (engine !== "codex") return;
    void invoke<EngineSettings>("engine_settings_get")
      .then(setSettings)
      .catch(() => undefined);
  }, [engine]);
  if (engine !== "codex" || !settings) return null;
  const fast = settings.codexServiceTier === "priority";
  const toggle = (on: boolean) => {
    const next = { ...settings, codexServiceTier: on ? "priority" : null };
    setSettings(next);
    void invoke("engine_settings_set", { settings: next }).catch(() => setSettings(settings));
  };
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem checked={fast} onCheckedChange={(on) => toggle(on === true)}>
        Fast
      </DropdownMenuCheckboxItem>
    </>
  );
}
