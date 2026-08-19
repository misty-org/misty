import {
  defaultAgentModelId,
  selectedAgentModelName,
  usePersonalAgentsStore,
} from "@/features/agents";
import {
  clearApiKey,
  DEFAULT_ANTHROPIC_URL,
  DEFAULT_OPENAI_COMPAT_URL,
  readApiKey,
  useAiSettings,
  writeApiKey,
  type ProviderId,
} from "@/features/coding-workspace";
import { Button, Input } from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { SelectControl, TextControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

const MODEL_SUGGESTIONS: Record<ProviderId, string[]> = {
  anthropic: ["claude-opus-4-5", "claude-sonnet-5", "claude-haiku-4-5"],
  "openai-compat": ["gpt-5.4", "gpt-5", "llama3.1", "qwen2.5-coder", "deepseek-chat"],
};

const PROVIDER_OPTIONS = ["Anthropic", "OpenAI-compatible"];

export function ModelsSection(props: SettingsContentProps) {
  return (
    <>
      <InlineAiModelSettings {...props} />
      <AgentDefaultModelSettings {...props} />
    </>
  );
}

/**
 * Inline AI (⌘K rewrite) provider, model, endpoint, and API key.
 * Reads/writes via `useAiSettings` (localStorage persistence) and
 * the keychain for API keys.
 */
function InlineAiModelSettings(props: SettingsContentProps) {
  const settings = useAiSettings();
  const [keyStatus, setKeyStatus] = useState<"loading" | "set" | "not-set">("loading");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void readApiKey(settings.providerId).then((existing) => {
      setKeyStatus(existing ? "set" : "not-set");
      settings.setHasKey(Boolean(existing));
      setKeyInput("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.providerId]);

  const providerIndex = settings.providerId === "anthropic" ? 0 : 1;

  const saveKey = async () => {
    setBusy(true);
    setNotice("");
    try {
      if (keyInput.trim()) {
        await writeApiKey(settings.providerId, keyInput.trim());
        settings.setHasKey(true);
        setKeyStatus("set");
        setNotice("Key saved.");
      }
      setKeyInput("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save key.");
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    setBusy(true);
    setNotice("");
    try {
      await clearApiKey(settings.providerId);
      settings.setHasKey(false);
      setKeyStatus("not-set");
      setNotice("Key removed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsSectionBlock title="Inline AI">
        <SettingsRow
          label="Provider"
          description="Anthropic uses the Messages API. OpenAI-compatible covers Ollama, LM Studio, OpenRouter, DeepSeek, Groq, Together."
        >
          <SelectControl
            value={providerIndex}
            options={PROVIDER_OPTIONS}
            disabled={props.working}
            onChange={(value) => settings.setProvider(value === 0 ? "anthropic" : "openai-compat")}
          />
        </SettingsRow>
        <SettingsRow
          label="Endpoint"
          description={`Default: ${settings.providerId === "anthropic" ? DEFAULT_ANTHROPIC_URL : DEFAULT_OPENAI_COMPAT_URL}`}
        >
          <TextControl
            value={settings.baseUrl}
            placeholder={
              settings.providerId === "anthropic"
                ? DEFAULT_ANTHROPIC_URL
                : DEFAULT_OPENAI_COMPAT_URL
            }
            disabled={props.working}
            wide
            onCommit={(value) =>
              settings.setBaseUrl(
                value.trim() ||
                  (settings.providerId === "anthropic"
                    ? DEFAULT_ANTHROPIC_URL
                    : DEFAULT_OPENAI_COMPAT_URL),
              )
            }
          />
        </SettingsRow>
        <SettingsRow label="Model" description="The model identifier sent with each request." last>
          <TextControl
            value={settings.model}
            placeholder={MODEL_SUGGESTIONS[settings.providerId]?.[0] ?? ""}
            disabled={props.working}
            onCommit={(value) => settings.setModel(value.trim())}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="API keys">
        <SettingsRow
          label={`${settings.providerId === "anthropic" ? "Anthropic" : "Bearer"} key`}
          description={
            keyStatus === "set"
              ? "A key is stored. You can replace or clear it."
              : "Paste your API key. It is stored in the OS keychain, never in plaintext."
          }
        >
          <div className="grid min-w-0 gap-2 justify-items-end max-[760px]:justify-items-start">
            <Input
              type="password"
              className="w-full max-w-[520px]"
              value={keyInput}
              placeholder={
                keyStatus === "set" ? "stored in keychain — replace or clear" : "paste your key"
              }
              disabled={busy || props.working}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setKeyInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && keyInput.trim()) void saveKey();
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={busy || props.working || !keyInput.trim()}
                onClick={() => void saveKey()}
              >
                {busy ? "Saving…" : "Set"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={busy || props.working || keyStatus !== "set"}
                onClick={() => void removeKey()}
              >
                Clear
              </Button>
            </div>
            {notice ? <span className="text-xs text-cream-muted">{notice}</span> : null}
          </div>
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

/**
 * The model a new agent chat starts on.
 */
function AgentDefaultModelSettings(props: SettingsContentProps) {
  const models = usePersonalAgentsStore((state) => state.models);
  const configured = defaultAgentModelId(props.document);
  const options = models.length > 0 ? models : [];
  const selectedIndex = Math.max(
    0,
    options.findIndex((model) => model.id === configured),
  );

  if (options.length === 0) return null;

  return (
    <SettingsSectionBlock title="Agents">
      <SettingsRow
        label="Default agent model"
        description="Used for new chats that do not pick their own model. Agents with a configured model are unaffected."
        last
      >
        <SelectControl
          value={selectedIndex}
          options={options.map((model) => selectedAgentModelName(model.id))}
          disabled={props.working}
          onChange={(value) => {
            const model = options[value];
            if (!model) return;
            props.onSettingChange("agent", "default_model_id", model.id);
          }}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
