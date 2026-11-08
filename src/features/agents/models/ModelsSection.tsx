import { DesktopSettingsNotice, DesktopSettingsSection as Section } from "@/features/settings";
import { useState } from "react";
import { ModelKeyRow } from "./ModelKeyRow";
import { ModelDropdownRow, ModelTextRow, useModelSetting } from "./ModelChoiceRows";
import { useChatgptAccount, useProviderModels, type AddedKey } from "./modelAccounts";
import { useSavedModelKeys } from "./modelKeys";
import { ModelSignInRows } from "./ModelSignInRows";
import { ModelTestRow } from "./ModelTestRow";
import { ConnectedAppsKeySection, WebSearchSection } from "./WebSearchSection";
import {
  defaultAgentModel,
  modelProviders,
  modelSuggestions,
  providerById,
  qualifiedModel,
  reasoningLevels,
  voiceProviders,
} from "./modelProviders";

/**
 * Settings › Models. Agents run on this computer, on a model account you bring: Sign in with
 * ChatGPT, OpenRouter's sign-in, or a key from any provider (its provider is found from the
 * key). Keys and sign-ins go to the keychain through the native app; the model choices are
 * device settings, and each model names its provider (`anthropic/claude-sonnet-5-5`). A web
 * search key is kept the same way (WebSearchSection).
 */
export function ModelsSection() {
  const keys = useSavedModelKeys();
  const chatgpt = useChatgptAccount();
  const provider = useModelSetting("models.provider");
  const agent = useModelSetting("models.agent_model");
  const [listRevision, setListRevision] = useState(0);
  const selected = providerById(provider.value) ?? modelProviders[0];
  const ready = selected.signIn
    ? Boolean(chatgpt.status?.planUsage)
    : Boolean(selected.keyOptional || keys.saved?.includes(selected.id));
  const listed = useProviderModels(selected.id, ready, listRevision);
  const suggest = (role: "agent" | "fast" | "embedding") =>
    modelSuggestions(selected, role, listed);
  const qualify = (value: string) => qualifiedModel(value, selected.id);
  const savedLabels = modelProviders
    .filter((item) => keys.saved?.includes(item.id))
    .map((item) => item.label);
  // A new account's provider becomes the one shown, and gives the agent a model when it has none.
  const adopt = (providerId: string, added?: AddedKey) => {
    if (providerId !== provider.value) provider.set(providerId);
    setListRevision((value) => value + 1);
    const first = added ? defaultAgentModel(providerId, added.models) : "";
    if (first && !agent.value) agent.set(first);
  };
  const saveKey = async (_providerId: string, key: string) => {
    const added = await keys.add(key, selected.id);
    if (added) adopt(added.provider, added);
    return Boolean(added);
  };
  return (
    <>
      {keys.error ? <DesktopSettingsNotice>{keys.error}</DesktopSettingsNotice> : null}
      <Section
        title="Sign-ins"
        description="Use a plan or account you already have. The sign-in stays on this computer."
      >
        <ModelSignInRows keys={keys} chatgpt={chatgpt} onSignedIn={adopt} />
      </Section>
      <Section
        title="Provider"
        description="Keys stay in this computer’s keychain and go only to the provider."
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
        {selected.signIn ? null : (
          <ModelKeyRow
            label="API key"
            description={
              selected.keyOptional
                ? `${selected.label} works without a key unless it asks for one.`
                : selected.keyPage
                  ? `Paste a key from ${selected.keyPage.replace(/^https:\/\//, "")}. It can’t be shown again once saved.`
                  : "Paste a key from any provider; Misty finds which one it’s for. It can’t be shown again once saved."
            }
            providerId={selected.id}
            saved={keys.saved}
            onSave={saveKey}
            onRemove={keys.remove}
          />
        )}
        {selected.baseUrlSetting ? (
          <ModelTextRow
            id={selected.baseUrlSetting}
            label="Base URL"
            description="This computer calls this address, so a server on it or your network works."
            placeholder={
              selected.id === "ollama" ? "http://127.0.0.1:11434/v1" : "http://127.0.0.1:8000/v1"
            }
          />
        ) : null}
      </Section>
      <Section
        title="Choices"
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
        <ModelTestRow disabled={!agent.value} />
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
          description="Searches memory and the library. Optional; that search is off when empty. ChatGPT has none."
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
      <WebSearchSection keys={keys} />
      <ConnectedAppsKeySection keys={keys} />
      <Section
        title="Voice keys"
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
            {voice.role === "speech" ? (
              <ModelTextRow
                id="models.speech_voice"
                label="ElevenLabs voice ID"
                description="The voice that reads answers aloud. Free plans need one of your own."
                normalize={(value) => value.trim()}
              />
            ) : null}
          </div>
        ))}
      </Section>
    </>
  );
}
