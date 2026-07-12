import { useEffect, useState } from "react";
import { Check, Eye, Palette, RotateCcw, Undo2 } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import type { PluginPanelProps } from "../types";

type ThemeToken = { token: string; label: string; value: string };
const defaultTokens: ThemeToken[] = [
  { token: "background", label: "Background", value: "#0B0D10" },
  { token: "surface", label: "Surface", value: "#111418" },
  { token: "foreground", label: "Primary text", value: "#F1F3F4" },
  { token: "muted", label: "Muted text", value: "#A7ABB3" },
  { token: "accent", label: "Accent", value: "#7DD3FC" },
  { token: "selection", label: "Selection", value: "#1E4F66" },
  { token: "success", label: "Success", value: "#22C55E" },
  { token: "warning", label: "Warning", value: "#EAB308" },
  { token: "danger", label: "Danger", value: "#EF4444" },
];
const presets = [
  { id: "misty-dark", label: "Misty Dark", colors: ["#0B0D10", "#7DD3FC"] },
  { id: "misty-light", label: "Misty Light", colors: ["#F5F2EC", "#246DC5"] },
  { id: "graphite", label: "Graphite", colors: ["#08090A", "#8BD3DD"] },
  { id: "aurora", label: "Aurora", colors: ["#071011", "#69D2C8"] },
  { id: "copper", label: "Copper", colors: ["#120F0D", "#E49F6A"] },
];
function validHex(value: string) { return /^#[0-9a-f]{6}$/i.test(value.trim()); }
function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrastRatio(first: string, second: string) {
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

export function ThemesPlugin({ context }: PluginPanelProps) {
  const [tokens, setTokens] = useState(defaultTokens);
  const [activePreset, setActivePreset] = useState("misty-dark");
  const [status, setStatus] = useState("Loading Misty’s current theme…");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");
  const [busy, setBusy] = useState(false);

  async function snapshot() {
    const result = await context.runHostCommand<{ ok?: boolean; themeId?: string; tokens?: Record<string, string>; message?: string }>("themes.snapshot");
    if (result.ok === false) { setTone("error"); setStatus(result.message ?? "Could not read the current theme."); return; }
    if (result.themeId) setActivePreset(result.themeId);
    if (result.tokens) setTokens((current) => current.map((item) => ({ ...item, value: result.tokens?.[item.token] ?? item.value })));
    setTone("neutral"); setStatus("Edit a color, preview it, then apply when it feels right.");
  }
  useEffect(() => { void snapshot(); }, []);

  function updateToken(token: string, value: string) { setTokens((current) => current.map((item) => item.token === token ? { ...item, value: value.toUpperCase() } : item)); }
  function payload() { return Object.fromEntries(tokens.map((item) => [item.token, item.value])); }
  function invalidToken() { return tokens.find((item) => !validHex(item.value)); }

  async function command(name: string, data: Record<string, unknown>, success: string) {
    const invalid = invalidToken();
    if (invalid && name !== "themes.revert") { setTone("error"); setStatus(`${invalid.label} must be a six-digit hex color.`); return; }
    if (name !== "themes.revert") {
      const values = payload();
      if (contrastRatio(values.foreground, values.background) < 4.5) { setTone("error"); setStatus("Primary text needs at least 4.5:1 contrast against the background."); return; }
      if (contrastRatio(values.muted, values.background) < 3) { setTone("error"); setStatus("Muted text needs at least 3:1 contrast against the background."); return; }
    }
    setBusy(true);
    const result = await context.runHostCommand<{ ok?: boolean; message?: string; tokens?: Record<string, string> }>(name, data);
    setBusy(false);
    setTone(result.ok === false ? "error" : "success"); setStatus(result.message ?? success);
    if (result.tokens) setTokens((current) => current.map((item) => ({ ...item, value: result.tokens?.[item.token] ?? item.value })));
  }

  async function applyPreset(id: string) {
    setActivePreset(id); setBusy(true);
    const result = await context.runHostCommand<{ ok?: boolean; message?: string; tokens?: Record<string, string> }>("themes.applyPreset", { preset: id, preview: true });
    setBusy(false);
    if (result.ok === false) { setTone("error"); setStatus(result.message ?? "Could not preview the preset."); return; }
    if (result.tokens) setTokens((current) => current.map((item) => ({ ...item, value: result.tokens?.[item.token] ?? item.value })));
    setTone("neutral"); setStatus(`Previewing ${presets.find((item) => item.id === id)?.label}. Apply to keep it.`);
  }

  return (
    <div className="panel-stack">
      <div className="panel-title"><h2>Themes</h2><p>Preview Misty presets or tune a focused set of accessible color tokens.</p></div>
      <div className="preset-grid">{presets.map((preset) => <button key={preset.id} type="button" className={`preset-card ${activePreset === preset.id ? "active" : ""}`} onClick={() => void applyPreset(preset.id)} disabled={busy}><span className="preset-colors"><i style={{ background: preset.colors[0] }} /><i style={{ background: preset.colors[1] }} /></span><strong>{preset.label}</strong>{activePreset === preset.id ? <Check size={14} /> : <Palette size={14} />}</button>)}</div>
      <div className="token-grid">{tokens.map((item) => <Field key={item.token} label={item.label}><div className="swatch-row"><input className="color-input" type="color" value={validHex(item.value) ? item.value : "#000000"} onChange={(event) => updateToken(item.token, event.target.value)} aria-label={`${item.label} color`} /><input className="text-input mono-input" value={item.value} onChange={(event) => updateToken(item.token, event.target.value)} aria-invalid={!validHex(item.value)} spellCheck={false} /></div></Field>)}</div>
      <StatusLine tone={tone}>{status}</StatusLine>
      <div className="action-row">
        <ActionButton type="button" onClick={() => void command("themes.apply", { preset: activePreset, tokens: payload() }, "Theme saved.")} disabled={busy}><Check size={16} />Apply Theme</ActionButton>
        <ActionButton type="button" className="secondary-button" onClick={() => void command("themes.preview", { tokens: payload() }, "Preview updated.")} disabled={busy}><Eye size={16} />Preview</ActionButton>
        <ActionButton type="button" className="secondary-button" onClick={() => void command("themes.revert", {}, "Reverted to the saved theme.")} disabled={busy}><Undo2 size={16} />Revert</ActionButton>
        <ActionButton type="button" className="secondary-button" onClick={() => { setTokens(defaultTokens); setActivePreset("misty-dark"); }} disabled={busy}><RotateCcw size={16} />Reset Fields</ActionButton>
      </div>
    </div>
  );
}
