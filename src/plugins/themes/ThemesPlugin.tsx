import { useState } from "react";
import { Check, Palette, RotateCcw } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import type { PluginPanelProps } from "../types";

type ThemeToken = {
  token: string;
  label: string;
  value: string;
};

const defaultTokens: ThemeToken[] = [
  { token: "window_bg", label: "Window background", value: "#111113" },
  { token: "panel_bg", label: "Panel background", value: "#18181B" },
  { token: "panel_alt_bg", label: "Elevated panel", value: "#27272A" },
  { token: "border", label: "Border", value: "#27272A" },
  { token: "text", label: "Primary text", value: "#D4D4D8" },
  { token: "text_muted", label: "Muted text", value: "#71717A" },
  { token: "accent", label: "Accent", value: "#3B82F6" },
  { token: "accent_hover", label: "Accent hover", value: "#2563EB" },
  { token: "selection", label: "Selection", value: "#3B82F659" },
  { token: "success", label: "Success", value: "#29BB88" },
  { token: "warning", label: "Warning", value: "#F7A134" },
  { token: "error", label: "Error", value: "#EF4444" },
];

const presets = [
  { id: "misty-dark", label: "Misty Dark" },
  { id: "gruvbox-dark", label: "Gruvbox" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "catppuccin-mocha", label: "Catppuccin" },
];

function validHex(value: string) {
  return /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.trim());
}

export function ThemesPlugin({ context }: PluginPanelProps) {
  const [tokens, setTokens] = useState(defaultTokens);
  const [status, setStatus] = useState("Load a preset or edit token hex values.");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");

  function updateToken(token: string, value: string) {
    setTokens((current) =>
      current.map((item) => item.token === token ? { ...item, value } : item),
    );
  }

  async function applyPreset(presetId: string, label: string) {
    const result = await context.runHostCommand<{ ok?: boolean; message?: string }>(
      "themes.applyPreset",
      { preset: presetId },
    );
    const ok = result.ok !== false;
    setTone(ok ? "success" : "error");
    setStatus(result.message ?? (ok ? `Applied ${label}.` : `Could not apply ${label}.`));
    context.notify(ok ? "success" : "error", "Themes", result.message ?? `Applied ${label}.`);
  }

  async function applyEdits() {
    const invalid = tokens.find((token) => !validHex(token.value));
    if (invalid) {
      setTone("error");
      setStatus(`Invalid color for ${invalid.label}.`);
      context.notify("error", "Themes", `Invalid color for ${invalid.label}.`);
      return;
    }

    const result = await context.runHostCommand<{ ok?: boolean; message?: string }>(
      "themes.applyTokens",
      { tokens: Object.fromEntries(tokens.map((token) => [token.token, token.value])) },
    );
    const ok = result.ok !== false;
    setTone(ok ? "success" : "error");
    setStatus(result.message ?? (ok ? "Applied custom theme edits." : "Could not apply theme edits."));
    context.notify(ok ? "success" : "error", "Themes", result.message ?? "Applied custom theme edits.");
  }

  return (
    <div className="panel-stack">
      <div className="panel-title">
        <h2>Themes</h2>
        <p>Apply curated presets, then tune Misty's core color tokens.</p>
      </div>

      <div className="action-row">
        {presets.map((preset) => (
          <ActionButton key={preset.id} type="button" onClick={() => applyPreset(preset.id, preset.label)}>
            <Palette size={16} aria-hidden="true" />
            {preset.label}
          </ActionButton>
        ))}
        <ActionButton
          type="button"
          className="secondary-button"
          onClick={() => {
            setTokens(defaultTokens);
            setTone("neutral");
            setStatus("Reset local token edits.");
          }}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Reset
        </ActionButton>
      </div>

      <div className="token-grid">
        {tokens.map((token) => (
          <Field key={token.token} label={token.label}>
            <div className="swatch-row">
              <span className="swatch" style={{ background: token.value }} aria-hidden="true" />
              <input
                className="text-input"
                value={token.value}
                onChange={(event) => updateToken(token.token, event.target.value)}
              />
            </div>
          </Field>
        ))}
      </div>

      <div className="action-row">
        <ActionButton type="button" onClick={applyEdits}>
          <Check size={16} aria-hidden="true" />
          Apply Edits
        </ActionButton>
      </div>

      <StatusLine tone={tone}>{status}</StatusLine>
    </div>
  );
}
