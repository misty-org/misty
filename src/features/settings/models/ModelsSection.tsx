import {
  DesktopSettingsNotice,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { ModelKeyRow } from "./ModelKeyRow";
import { ModelDropdownRow, ModelTextRow, useModelSetting } from "./ModelChoiceRows";
import { useOperatorModels, useSavedModelKeys } from "./modelKeys";
import {
  modelProviders,
  providerById,
  qualifiedModel,
  reasoningLevels,
  voiceProviders,
} from "./modelProviders";

/**
 * Settings › Models: bring your own keys. Keys go to the keychain through the native app;
 * the model choices are device settings. Several providers can hold keys at once, so each
 * model names its provider (`anthropic/claude-sonnet-5-5`).
 */
export function ModelsSection() {
  const keys = useSavedModelKeys();
  const operator = useOperatorModels();
  const provider = useModelSetting("models.provider");
  const selected = providerById(provider.value) ?? modelProviders[0];
  const suggest = (role: "agent" | "fast" | "embedding") =>
    selected.suggestions[role].map((model) => `${selected.id}/${model}`);
  const qualify = (value: string) => qualifiedModel(value, selected.id);
  const savedLabels = modelProviders
    .filter((item) => keys.saved?.includes(item.id))
    .map((item) => item.label);
  return (
    <>
      {keys.error ? <DesktopSettingsNotice>{keys.error}</DesktopSettingsNotice> : null}
      <Section
        title="Provider"
        description={
          operator
            ? "This Misty server provides its own models, so everything here is optional. Models you set here are used instead of the server’s."
            : "Misty runs on your own keys. They stay in this device’s keychain and go only to your Misty server, with each AI request."
        }
      >
        <ModelDropdownRow
          id="models.provider"
          label="Provider"
          description={
            savedLabels.length
              ? `The provider whose key and models you are editing. Keys saved for ${savedLabels.join(", ")}.`
              : "The provider whose key and models you are editing."
          }
          options={modelProviders.map((item) => ({ value: item.id, label: item.label }))}
        />
        <ModelKeyRow
          label="API key"
          description={
            selected.keyOptional
              ? `${selected.label} works without a key unless your server asks for one.`
              : `Your ${selected.label} key. It can’t be shown again once saved.`
          }
          providerId={selected.id}
          saved={keys.saved}
          onSave={keys.save}
          onRemove={keys.remove}
        />
        {selected.baseUrlSetting ? (
          <ModelTextRow
            id={selected.baseUrlSetting}
            label="Base URL"
            description={`Where your ${selected.label} server listens, reachable from your Misty server.`}
            placeholder={
              selected.id === "ollama" ? "http://localhost:11434/v1" : "http://localhost:8000/v1"
            }
          />
        ) : null}
      </Section>
      <Section
        title="Models"
        description="Write a model as provider/model. A name without a provider uses the provider above."
      >
        <ModelTextRow
          id="models.agent_model"
          label="Agent model"
          description="Thinks, plans and reads screens. AI stays off until this is set."
          placeholder={suggest("agent")[0] ?? `${selected.id}/model`}
          suggestions={suggest("agent")}
          normalize={qualify}
        />
        <ModelTextRow
          id="models.fast_model"
          label="Fast model"
          description="Routing, cleanup and summaries. Optional; the agent model does these when empty."
          placeholder="Same as agent model"
          suggestions={suggest("fast")}
          normalize={qualify}
        />
        <ModelTextRow
          id="models.embedding_model"
          label="Embedding model"
          description="Searches memory and the library. Optional; that search is off when empty."
          placeholder="Off"
          suggestions={suggest("embedding")}
          normalize={qualify}
        />
        <ModelDropdownRow
          id="models.reasoning"
          label="Reasoning effort"
          description="How long the agent model thinks before answering. Higher is slower and costs more."
          options={reasoningLevels}
        />
      </Section>
      <Section
        title="Voice"
        description="Optional keys for reading answers aloud and for dictation."
      >
        {voiceProviders.map((voice) => (
          <div key={voice.id}>
            <ModelKeyRow
              label={`${voice.label} key`}
              description={
                voice.role === "speech"
                  ? "Reads answers aloud."
                  : "Transcribes dictation and voice messages."
              }
              providerId={voice.id}
              saved={keys.saved}
              onSave={keys.save}
              onRemove={keys.remove}
            />
            <ModelTextRow
              id={voice.role === "speech" ? "models.speech_model" : "models.transcription_model"}
              label={voice.role === "speech" ? "Speech model" : "Transcription model"}
              description={`Used when the ${voice.label} key is saved, or another provider you name here has one.`}
              normalize={(value) => qualifiedModel(value, voice.id)}
            />
          </div>
        ))}
      </Section>
    </>
  );
}
