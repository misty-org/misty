import { useEffect, useState } from "react";
import { cn } from "@/shared/ui";
import { clearApiKey, readApiKey, writeApiKey } from "./keychain";
import {
  DEFAULT_ANTHROPIC_URL,
  DEFAULT_OPENAI_COMPAT_URL,
  type ProviderId,
} from "./providers";
import { useAiSettings } from "./useAiSettings";

interface AiSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const MODEL_SUGGESTIONS: Record<ProviderId, string[]> = {
  anthropic: ["claude-opus-4-5", "claude-sonnet-5", "claude-haiku-4-5"],
  "openai-compat": ["gpt-5.4", "gpt-5", "llama3.1", "qwen2.5-coder", "deepseek-chat"],
};

const aiInputClass = [
  "h-8 w-full rounded-md border border-charcoal-border bg-charcoal-bg px-2",
  "font-mono text-[12px] text-cream outline-none focus:border-charcoal-active",
].join(" ");

export function AiSettingsDialog({ open, onClose }: AiSettingsDialogProps) {
  const settings = useAiSettings();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    void readApiKey(settings.providerId).then((existing) => {
      setApiKey(existing ?? "");
      settings.setHasKey(Boolean(existing));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.providerId]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      if (apiKey.trim()) {
        await writeApiKey(settings.providerId, apiKey.trim());
        settings.setHasKey(true);
      } else {
        await clearApiKey(settings.providerId);
        settings.setHasKey(false);
      }
      setStatus("Saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-charcoal-border bg-charcoal-card p-6 shadow-2xl"
      >
        <h2 className="text-lg font-medium text-cream-bright">Inline AI</h2>
        <p className="mt-1 text-xs text-cream-muted">
          Configure the model used by <span className="font-mono">⌘K</span>. Keys are stored in
          the OS keychain via <span className="font-mono">tauri-plugin-keystore</span>.
        </p>

        <div className="mt-5 space-y-4 text-sm">
          <Field label="Provider">
            <div className="flex gap-2">
              <ProviderButton
                active={settings.providerId === "anthropic"}
                onClick={() => settings.setProvider("anthropic")}
              >
                Anthropic
              </ProviderButton>
              <ProviderButton
                active={settings.providerId === "openai-compat"}
                onClick={() => settings.setProvider("openai-compat")}
              >
                OpenAI-compatible
              </ProviderButton>
            </div>
            <p className="mt-1 text-[11px] text-cream-muted">
              OpenAI-compatible covers Ollama, LM Studio, OpenRouter, DeepSeek, Groq, Together —
              anything that speaks <span className="font-mono">POST /v1/chat/completions</span>.
            </p>
          </Field>

          <Field label="Endpoint">
            <input
              value={settings.baseUrl}
              onChange={(event) => settings.setBaseUrl(event.target.value)}
              className={aiInputClass}
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-cream-muted">
              Default:{" "}
              <span className="font-mono">
                {settings.providerId === "anthropic"
                  ? DEFAULT_ANTHROPIC_URL
                  : DEFAULT_OPENAI_COMPAT_URL}
              </span>
            </p>
          </Field>

          <Field label="Model">
            <input
              value={settings.model}
              onChange={(event) => settings.setModel(event.target.value)}
              className={aiInputClass}
              spellCheck={false}
              list="ai-model-suggestions"
            />
            <datalist id="ai-model-suggestions">
              {MODEL_SUGGESTIONS[settings.providerId].map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </Field>

          <Field label={`${settings.providerId === "anthropic" ? "API" : "Bearer"} key`}>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className={aiInputClass}
              placeholder={settings.hasKey ? "stored in keychain — replace or clear" : "paste your key"}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          {status ? <p className="text-xs text-cream-muted">{status}</p> : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-charcoal-border px-3 py-1.5 text-sm text-cream-muted hover:text-cream"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save().then(() => onClose())}
            disabled={busy}
            className="rounded-md bg-cream-bright px-3 py-1.5 text-sm font-medium text-charcoal-workspace hover:bg-cream disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-cream-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function ProviderButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md border px-3 py-1.5 text-sm",
        active
          ? "border-cream-bright bg-charcoal-hover text-cream-bright"
          : "border-charcoal-border text-cream-muted hover:text-cream",
      )}
    >
      {children}
    </button>
  );
}
