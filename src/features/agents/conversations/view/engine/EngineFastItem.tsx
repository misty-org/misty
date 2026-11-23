import { Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@/native/invoke";
import { MenuCheckItem, MenuSeparator } from "@misty/ui";
import type { EngineModel } from "../../../engines/engines_api";

interface EngineSettings {
  codexServiceTier?: string | null;
  claudeFastMode?: boolean | null;
  [key: string]: unknown;
}

export function EngineFastItem({ engine, model }: { engine?: string; model?: EngineModel }) {
  const fast = model?.fast;
  const [settings, setSettings] = useState<EngineSettings>();
  const offered = Boolean(fast) && (engine === "claude" || engine === "codex");
  useEffect(() => {
    if (!offered) return;
    void invoke<EngineSettings>("engine_settings_get")
      .then(setSettings)
      .catch(() => undefined);
  }, [offered]);
  if (!offered || !fast || !settings) return null;
  const on =
    engine === "claude"
      ? settings.claudeFastMode === true
      : settings.codexServiceTier === fast.tier;
  const toggle = (next: boolean) => {
    const changed =
      engine === "claude"
        ? { ...settings, claudeFastMode: next ? true : null }
        : { ...settings, codexServiceTier: next ? fast.tier : null };
    setSettings(changed);
    void invoke("engine_settings_set", { settings: changed }).catch(() => setSettings(settings));
  };
  return (
    <>
      <MenuSeparator />
      <MenuCheckItem icon={Zap} label={fast.label} checked={on} onCheckedChange={toggle} />
    </>
  );
}
